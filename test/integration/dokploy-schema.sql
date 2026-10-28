-- The columns of Dokploy's schema (packages/server/src/db/schema) that the sync reads.
CREATE TYPE "domainType" AS ENUM ('compose', 'application', 'preview');

CREATE TYPE "applicationStatus" AS ENUM ('idle', 'running', 'done', 'error');

CREATE TYPE "composeStatus" AS ENUM ('idle', 'running', 'done', 'error');

CREATE TABLE project (
  "projectId" text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE environment (
  "environmentId" text PRIMARY KEY,
  name text NOT NULL,
  "projectId" text NOT NULL REFERENCES project ("projectId") ON DELETE CASCADE,
  "isDefault" boolean NOT NULL DEFAULT false
);

CREATE TABLE application (
  "applicationId" text PRIMARY KEY,
  name text NOT NULL,
  "applicationStatus" "applicationStatus" NOT NULL DEFAULT 'idle',
  "environmentId" text NOT NULL REFERENCES environment ("environmentId") ON DELETE CASCADE
);

CREATE TABLE compose (
  "composeId" text PRIMARY KEY,
  name text NOT NULL,
  "composeStatus" "composeStatus" NOT NULL DEFAULT 'idle',
  "environmentId" text NOT NULL REFERENCES environment ("environmentId") ON DELETE CASCADE
);

CREATE TABLE domain (
  "domainId" text PRIMARY KEY,
  host text NOT NULL,
  https boolean NOT NULL DEFAULT false,
  port integer DEFAULT 3000,
  path text DEFAULT '/',
  "serviceName" text,
  "domainType" "domainType" DEFAULT 'application',
  "createdAt" text NOT NULL,
  "composeId" text REFERENCES compose ("composeId") ON DELETE CASCADE,
  "applicationId" text REFERENCES application ("applicationId") ON DELETE CASCADE,
  "previewDeploymentId" text,
  middlewares text[] DEFAULT ARRAY[]::text[],
  "forwardAuthEnabled" boolean NOT NULL DEFAULT false
);
