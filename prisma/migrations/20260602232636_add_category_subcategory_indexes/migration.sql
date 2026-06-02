-- CreateIndex
CREATE INDEX "Category_status_createdAt_idx" ON "Category"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Subcategory_categoryId_status_idx" ON "Subcategory"("categoryId", "status");

-- CreateIndex
CREATE INDEX "Subcategory_categoryId_createdAt_idx" ON "Subcategory"("categoryId", "createdAt");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE INDEX "User_status_createdAt_idx" ON "User"("status", "createdAt");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
