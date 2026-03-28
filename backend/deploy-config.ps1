# deploy-config.ps1 — run this whenever you need to update env/secrets
$IMAGE = "asia-south1-docker.pkg.dev/project-06a3af2a-0437-48ad-802/pscrm/backend:v3"

gcloud run deploy pscrm-backend `
  --image asia-south1-docker.pkg.dev/project-06a3af2a-0437-48ad-802/pscrm/backend:v `
  --region asia-south1 `
  --set-env-vars="PUBSUB_ENABLED=true,GCS_ENABLED=true,GCS_PROJECT_ID=project-06a3af2a-0437-48ad-802,VERTEX_AI_LOCATION=asia-south1,GCS_BUCKET_NAME=pscrm_complaint,SMTP_HOST=smtp.gmail.com,SMTP_PORT=587,FIREBASE_PROJECT_ID=ps-crm-7eb03,FIREBASE_SERVICE_ACCOUNT_PATH=/firebase/sa.json,GCS_SERVICE_ACCOUNT_KEY_PATH=/gcs/sa.json,GOOGLE_APPLICATION_CREDENTIALS=/gcs/sa.json,FRONTEND_URL=https://psrminno.vercel.app" `
  --set-secrets="DATABASE_URL=pscrm-db-url:latest,GEMINI_API_KEY=pscrm-gemini-key:latest,GROQ_API_KEY=pscrm-groq-key:latest,NOMIC_API_KEY=pscrm-nomic-key:latest,SMTP_USER=pscrm-smtp-user:latest,SMTP_PASSWORD=pscrm-smtp-pass:latest,PUBSUB_PUSH_SECRET=pscrm-pubsub-secret:latest,AUTH_JWT_SECRET=pscrm-jwt-secret:latest,/firebase/sa.json=pscrm-firebase-sa:latest,/gcs/sa.json=pscrm-gcs-sa:latest"