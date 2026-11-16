# Project Migration Hub

/skill:migrate-external-project Source: code archive. Migrate the attached project into Lovable.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/405e94bd-0c3a-4a03-afa5-fefa756f3051).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

### Run against the PHP backend

1. Configure MySQL and the PHP backend in `backend/.env`, import `database/schema.sql`, and serve `backend/public/` through Apache. Map the `/api` URL prefix directly to `backend/public/`; the XAMPP configuration in this workspace does this at `http://localhost/api`.
2. From this directory, copy `.env.example` to `.env.local` and set `VITE_PHP_BACKEND_URL` to the Apache origin (for this XAMPP setup, `http://localhost`). Leave `VITE_USE_DEMO_BACKEND=false` and `VITE_API_BASE_URL=/api`.
3. Install dependencies and start Vite:

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. Its development proxy forwards `/api` requests to Apache, including the PHP session cookie and CSRF header. Do not expose `.env.local` or production database credentials.

For production, configure the web server to proxy `/api` to the PHP backend and set `VITE_API_BASE_URL=/api` at build time. The Vite proxy is for local development only.

### Local UI demo

Set `VITE_USE_DEMO_BACKEND=true` in `.env.local` to use the built-in sample-data backend. Demo mode is explicit; a failed live API request does not switch to demo data automatically.
