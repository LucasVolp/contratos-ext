generator client {
  provider = "prisma-client-js"
}

generator erd {
  provider = "prisma-erd-generator"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Status {
  PENDING
  IN_PROGRESS
  COMPLETED
  CANCELLED
  INACTIVE
  OVERDUE
  PREDICTED
}

enum NotificationTypeEnum {
  ERROR
  WARNING
  INFO
  SUCCESS
  PROCESS_STARTED
  PROCESS_COMPLETED
  PROCESS_CANCELLED
  PROCESS_IN_PROGRESS
  STEP_ASSIGNED
  STEP_COMPLETED
  STEP_CANCELLED
  STEP_OVERDUE
  DOCUMENT_REQUIRED
}

model User {
  id            String          @id @default(uuid())
  firstName     String
  lastName      String
  picture       String?
  email         String          @unique
  password      String
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
  // Relação one-to-many com CompletedStep: um usuário pode ter muitos passos completados
  completedStep CompletedStep[]
  sessions      Session[]

  @@index([email])
  @@index([firstName])
}

model Session {
  id            String   @id @unique @default(uuid())
  refresh_token String
  expires_at    DateTime
  userId        String
  User          User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("sessions")
}

model Activity {
  id          String   @id @default(uuid())
  name        String
  description String
  order       Int?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  // Relação one-to-many com Step: uma atividade pode ter muitos passos
  step        Step[]

  @@index([name])
  @@index([order])
}

model Step {
  id                      String          @id @default(uuid())
  description             String
  originSector            Sector          @relation("originSector", fields: [originSectorId], references: [id])
  originSectorId          String
  destinySector           Sector          @relation("destinySector", fields: [destinySectorId], references: [id])
  destinySectorId         String
  template                String?
  estimatedCompletionDays Int
  status                  Status
  order                   Int
  // Relação many-to-one com Activity: cada passo pertence a uma única atividade
  activity                Activity?       @relation(fields: [activityId], references: [id])
  activityId              String?
  // Relação one-to-many com CompletedStep: um passo pode ter muitas instâncias completadas
  completedStep           CompletedStep[]
  modalityId              String?
  modality                Modality?       @relation(fields: [modalityId], references: [id])

  @@index([activityId, modalityId])
  @@index([status])
  @@index([estimatedCompletionDays])
  @@index([originSectorId])
  @@index([destinySectorId])
}

model CompletedStep {
  id          String    @id @default(uuid())
  stepId      String
  checklistId String
  // Relação many-to-one com Checklist: cada completedStep pertence a um único checklist
  checklist   Checklist @relation(fields: [checklistId], references: [id])
  // Relação many-to-one com Step: cada completedStep está associada a um único step
  step        Step      @relation(fields: [stepId], references: [id])
  status      Status
  order       Int
  completedAt DateTime  @default(now())
  // Relação many-to-one com User: cada completedStep é realizado por um único usuário
  user        User?     @relation(fields: [userId], references: [id])
  userId      String?

  @@index([stepId])
  @@index([checklistId])
  @@index([userId])
  @@index([status])
  @@index([completedAt])
}

model Checklist {
  id            String          @id @default(uuid())
  // Relação one-to-one com Process: cada checklist pertence a um único processo
  process       Process         @relation(fields: [processId], references: [id], onDelete: Cascade)
  processId     String          @unique
  // Relação one-to-many com CompletedStep: um checklist pode ter muitos passos completados
  completedStep CompletedStep[]
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  @@index([processId])
}

model Unit {
  id                 String              @id @default(uuid())
  name               String
  color              String
  shortName          String
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt
  // Relação one-to-many com Process: uma unidade pode gerenciar muitos processos
  processes          Process[]
  // Relação one-to-many com ParticipatingUnit: uma unidade pode participar de muitos processos
  participatingUnits ParticipatingUnit[]
  Notification       Notification[]

  @@index([name])
}

model ProcessType {
  id        String    @id @default(uuid())
  name      String
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  // Relação one-to-many com Process: um tipo de processo pode ter muitos processos
  processes Process[]

  @@index([name])
}

model Process {
  id                    String              @id @default(uuid())
  processNumber         String              @unique
  objectDescription     String
  // Relação many-to-one com ProcessType: cada processo tem um único tipo
  processType           ProcessType         @relation(fields: [processTypeId], references: [id], onDelete: Cascade)
  processTypeId         String
  // Relação many-to-one com Unit: cada processo é gerenciado por uma única unidade
  executingUnit         Unit                @relation(fields: [executingUnitId], references: [id], onDelete: Cascade)
  executingUnitId       String
  // Relação many-to-one com Modality: cada processo tem uma única modalidade
  modalityId            String?
  modality              Modality?           @relation(fields: [modalityId], references: [id])
  // Relação one-to-many com ParticipatingUnit: um processo pode ter muitas unidades participantes
  participatingUnits    ParticipatingUnit[]
  //costing               Float
  situation             Status //float
  estimatedValue        Float
  //totalValue            Float
  //supplierValue         Float
  object                String
  adictionalInformation String
  priority              Int
  startDate             DateTime            @default(now())
  expectedEndDate       DateTime
  createdAt             DateTime            @default(now())
  updatedAt             DateTime            @updatedAt

  // // Relação one-to-one com Checklist: cada processo tem um único checklist
  checklist    Checklist?
  checklistId  String?        @unique
  Notification Notification[]

  @@index([processNumber])
  @@index([processTypeId])
  @@index([executingUnitId])
  @@index([situation])
  @@index([priority])
  @@index([createdAt])
}

model Modality {
  id        String    @id @default(uuid())
  name      String
  processes Process[]
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  steps     Step[]

  @@index([name])
  @@index([createdAt])
  @@index([updatedAt])
}

model ParticipatingUnit {
  id        String   @id @default(uuid())
  // Relação many-to-one com Unit: cada participação está associada a uma única unidade
  unit      Unit     @relation(fields: [unitId], references: [id])
  unitId    String
  // Relação many-to-one com Process: cada participação está associada a um único processo
  process   Process  @relation(fields: [processId], references: [id], onDelete: Cascade)
  processId String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // A anotação @@unique([unitId, processId]) é usada para garantir que cada unidade participante seja única para cada processo.
  @@unique([unitId, processId])
  @@index([unitId])
  @@index([processId])
}

model Sector {
  id                     String         @id @default(uuid())
  shortName              String
  description            String
  responsible_name       String
  responsible_email      String
  originSteps            Step[]         @relation("originSector")
  destinySteps           Step[]         @relation("destinySector")
  createdAt              DateTime       @default(now())
  updatedAt              DateTime       @updatedAt
  notificationsAsDestiny Notification[] @relation("NotificationDestinySector")
  notificationsAsOrigin  Notification[] @relation("NotificationOriginSector")
}

model Notification {
  id                 String               @id @default(uuid())
  title              String
  message            String
  read               Boolean              @default(false)
  readDate           DateTime?
  process            Process              @relation(fields: [processId], references: [id])
  processId          String
  notificationType   NotificationTypeEnum
  destinySector      Sector               @relation("NotificationDestinySector", fields: [destinySectorId], references: [id])
  destinySectorId    String
  originSector       Sector               @relation("NotificationOriginSector", fields: [originSectorId], references: [id])
  originSectorId     String
  ownerUnit          Unit                 @relation(fields: [ownerUnitId], references: [id])
  ownerUnitId        String
  createdAt          DateTime             @default(now())
  updatedAt          DateTime             @updatedAt


  @@index([processId])
  @@index([destinySectorId])
  @@index([originSectorId])
  @@index([ownerUnitId])
  @@index([notificationType])
  @@index([read])
  @@index([readDate])
}

