-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('pending', 'in_progress', 'resolved');

-- CreateTable
CREATE TABLE "SkillFeedback" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'pending',
    "submitterEmployeeId" TEXT NOT NULL,
    "contextVersionId" TEXT,
    "resolverEmployeeId" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SkillFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SkillFeedback_skillId_idx" ON "SkillFeedback"("skillId");

-- AddForeignKey
ALTER TABLE "SkillFeedback" ADD CONSTRAINT "SkillFeedback_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillFeedback" ADD CONSTRAINT "SkillFeedback_submitterEmployeeId_fkey" FOREIGN KEY ("submitterEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillFeedback" ADD CONSTRAINT "SkillFeedback_contextVersionId_fkey" FOREIGN KEY ("contextVersionId") REFERENCES "SkillVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillFeedback" ADD CONSTRAINT "SkillFeedback_resolverEmployeeId_fkey" FOREIGN KEY ("resolverEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
