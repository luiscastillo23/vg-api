# 11 — Real-time chat

In-order conversations between customer and support — one persistent `Conversation` per `Order`. Real-time delivery uses Socket.IO; persistence stays in Postgres. This file covers the gateway, room model, message persistence, scaling, and the interaction with `NotificationsService`.

> Section index: [What & why](#what--why) · [Model](#model) · [Gateway](#gateway) · [Connection lifecycle](#connection-lifecycle) · [Events](#events) · [Persistence](#persistence) · [Notifications](#notifications) · [Scaling](#scaling) · [Failure modes](#failure-modes) · [Testing](#testing)

## What & why

A buyer asks "where's my order?" and an admin answers. The conversation is scoped to the order — when the order is resolved, the conversation is archived but readable. Why not generic ticketing?

- One conversation per order keeps the model boring and queryable ("all messages for order X").
- The participants list is implicit: `order.userId` (the buyer) plus `ADMIN`/`MANAGER`.
- It composes with the notifications module: every received message produces a `Notification` for the offline party.

REST endpoints handle CRUD; the WebSocket gateway only handles **delivery** (and presence/typing). Persistence is always through the service so an offline send via REST works exactly the same as an online send via socket.

## Model

```prisma
model Conversation {
  id            String     @id @default(cuid())
  orderId       String     @unique
  customerId    String                                  // == order.userId
  status        ConvStatus @default(OPEN)
  lastMessageAt DateTime?
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  order         Order      @relation(fields: [orderId],    references: [id], onDelete: Cascade)
  customer      User       @relation("ConvCustomer", fields: [customerId], references: [id])
  messages      Message[]
  @@index([customerId, status])
}

model Message {
  id             String       @id @default(cuid())
  conversationId String
  senderId       String                                  // User.id of customer OR admin
  body           String                                  // plain text; HTML escaped on render
  attachments    Json?                                   // [{ url, mime, sizeBytes }]
  readAt         DateTime?                               // when the OTHER party last read it
  createdAt      DateTime     @default(now())
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender         User         @relation(fields: [senderId], references: [id])
  @@index([conversationId, createdAt])
}

enum ConvStatus {
  OPEN
  RESOLVED
  ARCHIVED
}
```

A `Conversation` is created lazily — the first message creates it via `upsert` keyed by `orderId`.

## Gateway

```ts
// modules/conversations/conversations.gateway.ts
@WebSocketGateway({
  namespace: 'chat',
  cors: { origin: process.env.WEB_URL_ORIGIN, credentials: true },
  path: '/ws',                          // → final URL: ws://host/ws/chat
})
export class ConversationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly auth: ClerkWsAuthService,        // verifyToken() wrapper
  ) {}

  async handleConnection(socket: Socket) { ... }
  async handleDisconnect(socket: Socket) { ... }

  @SubscribeMessage('conversation:join')
  async onJoin(@ConnectedSocket() s: Socket, @MessageBody() { conversationId }: { conversationId: string }) { ... }

  @SubscribeMessage('message:send')
  async onSend(@ConnectedSocket() s: Socket, @MessageBody() dto: SendMessageDto) { ... }

  @SubscribeMessage('typing:start')
  onTypingStart(...) { ... }

  @SubscribeMessage('message:read')
  onRead(...) { ... }
}
```

The gateway is the **transport** — every persistence side-effect goes through `ConversationsService`, never directly into Prisma from the gateway.

## Connection lifecycle

```
1. Client opens socket: io('/chat', { auth: { token: clerkSessionToken }})
2. handleConnection:
     - extract token from socket.handshake.auth.token
     - verifyToken() — throws → socket.disconnect(reason='unauthorized')
     - look up local User by clerkId → reject if not ACTIVE
     - attach socket.data.user = AuthenticatedUser
3. Client emits 'conversation:join' { conversationId }
     - verify the user is a participant (customer or staff)
     - socket.join(`conv:${conversationId}`)
     - emit('conversation:state', { lastReadAt, unreadCount, recentMessages })
4. Messages flow via 'message:send' / 'message:received'
5. On disconnect, leave all rooms (Socket.IO does this automatically)
```

There's no implicit "join all my conversations" — the client picks which conversation it's looking at and joins that room. Background notifications use the persistent `Notification` rows + the notifications module's own delivery, not the chat socket.

## Events

Server → client:

| Event                        | Payload                                                  | When                                         |
| ---------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| `conversation:state`         | `{ lastReadAt, unreadCount, recentMessages }`            | After successful `conversation:join`.        |
| `message:received`           | `{ id, conversationId, senderId, body, attachments, createdAt }` | Emitted to the conversation room (excluding the sender) after a message is persisted. |
| `message:read`               | `{ messageId, readAt, readerId }`                        | When the recipient marks a message read.     |
| `typing:start` / `typing:stop` | `{ userId, conversationId }`                           | Broadcast to room (excluding the source).    |
| `conversation:resolved`      | `{ conversationId }`                                     | When an admin resolves the conversation.     |

Client → server (`@SubscribeMessage`):

| Event                | DTO                                              |
| -------------------- | ------------------------------------------------ |
| `conversation:join`  | `{ conversationId }`                             |
| `message:send`       | `{ conversationId, body, attachments? }`         |
| `message:read`       | `{ messageId }`                                  |
| `typing:start`       | `{ conversationId }`                             |
| `typing:stop`        | `{ conversationId }`                             |

All client→server payloads are validated by `class-validator` via Nest's `ValidationPipe` configured on the gateway. Bad payloads are rejected with a `ws-exception` and **don't** kill the socket — the client should display "message failed".

## Persistence

The send path:

```
SubscribeMessage 'message:send'
  → ValidationPipe → SendMessageDto
  → ConversationsService.send(senderId, dto)
       1. Resolve order + conversation (lazy create via upsert on orderId)
       2. Verify senderId is allowed to post (customer OR admin/manager)
       3. tx.message.create({ conversationId, senderId, body, attachments })
       4. tx.conversation.update({ lastMessageAt: now() })
  → server.to(`conv:${conversationId}`).except(senderSocketId).emit('message:received', payload)
  → emit('chat.message', { messageId, conversationId, senderId }) // domain event
```

Why we emit `chat.message` even when both parties are online: `NotificationsService` writes a `Notification` row regardless, so when the recipient closes their tab and reopens it, the `GET /notifications` feed shows the unread count.

## Notifications

The `chat.message` domain event has `NotificationsService` as consumer:

```ts
@OnEvent('chat.message', { async: true })
async onChatMessage({ messageId, conversationId, senderId }) {
  const conv = await this.conversations.findByIdLite(conversationId);
  const recipientId = senderId === conv.customerId ? <pickStaff()> : conv.customerId;
  await this.notifications.create({
    userId: recipientId,
    type: 'CHAT',
    title: 'New message',
    body: '...',
    payload: { conversationId, messageId },
  });
  // Optional email fan-out if recipient has been offline > 5 min
}
```

The notifications module decides delivery (in-app + email digest). The chat module emits and walks away.

## Scaling

The default Socket.IO server holds rooms in process memory. As soon as we run more than one API instance behind a load balancer, a message sent on instance A doesn't reach a subscriber on instance B.

When that day comes:

1. Install `@socket.io/redis-adapter` + `ioredis`.
2. Configure the gateway with `setAdapter(createAdapter(pub, sub))`.
3. Use the same Redis instance we're already using for the reports cache.
4. The room semantics don't change — clients still `join(conv:<id>)`, the adapter fans out across instances.

The throttler note from [06-infrastructure.md](./06-infrastructure.md#scaling-notes) applies: per-instance in-memory rate limits won't suffice once we shard the gateway across instances. Move to Redis-backed throttler at the same time.

Connection limits per instance: Socket.IO comfortably holds 10–20k concurrent connections per Node process for chat-like workloads (mostly idle, low message rate). For more, run more instances; don't tune `ulimit` and call it scaling.

## Failure modes

| Symptom                                   | Likely cause                                   | Fix                                              |
| ----------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| Socket disconnects immediately, code 4401 | Token expired or `azp` mismatch                | Frontend refreshes token via Clerk; verify `CLERK_AUTHORIZED_PARTIES`. |
| Messages send but never arrive            | Two instances, no Redis adapter                | Install `@socket.io/redis-adapter`.              |
| Duplicate messages on the recipient       | Adapter installed twice or two namespaces      | Audit `setAdapter` calls; only one per namespace. |
| Memory grows unbounded                    | Rooms not freed on disconnect                  | Don't store room membership outside Socket.IO's own maps. |
| 503 on `/health`                          | Redis unreachable                              | Check Redis. Health probe is OK to fail open during planned cache restarts only. |
| CORS rejects WS handshake                 | `WEB_URL_ORIGIN` mismatch                      | Match scheme + port exactly.                     |

## Testing

| Layer                         | Approach                                                                |
| ----------------------------- | ----------------------------------------------------------------------- |
| Service unit tests            | Mock the repository. Test the "lazy conversation creation" upsert path. |
| Gateway unit tests            | Drive `@SubscribeMessage` handlers directly with a fake `Socket`.       |
| E2E (single instance)         | Spawn the app, connect with `socket.io-client`, exchange a message round-trip, assert DB persistence. |
| Multi-instance (later)        | Two processes + Redis adapter, send from one, receive on the other.     |

Don't test "Socket.IO emits to the right room" — that's framework. Test "given a message-send, a message row exists, the event is emitted to the room, the recipient gets a Notification."

## Cross-references

- [02-data-model.md](./02-data-model.md) — `Conversation` + `Message`
- [04-api-rest.md#real-time-chat-wschat](./04-api-rest.md#real-time-chat--wschat) — WS handshake auth
- [05-patterns.md#domain-events](./05-patterns.md#domain-events) — `chat.message` event
- [13-emails-brevo.md](./13-emails-brevo.md) — offline mail fan-out (when added)
- [16-observability.md](./16-observability.md) — WS metrics
