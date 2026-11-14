# SocialScope

A small Node.js website for exploring publicly available social-platform information.

## Features currently included

- Official YouTube Data API v3 lookup for public channel details, channel ID, creation date, public statistics and recent public uploads.
- Public comment-thread retrieval for returned YouTube videos.
- Local account timeline: stores first-observed snapshots in the browser and detects later changes to display name, handle, bio and profile image.
- Public website DNS lookup for a domain entered by the user: IPv4, IPv6, name servers and CNAME records.
- Clear explanations for unavailable or private data.

## Platform and privacy limits

TikTok, Instagram and X live integrations are not enabled. Each platform has separate API access rules, credentials, permissions and review requirements. TikTok's official Display API requires an account holder to authorize the app; it is not an unrestricted username-search API. Do not promise access to private likes, saves, messages, private follow history or other non-public information.

The DNS lookup returns public DNS records for a website domain. It does not locate a social-media user or reveal the IP address of their phone, computer or home network.

## Deploy publicly on Render

The repository includes `render.yaml` for a Render Blueprint deployment.

1. Create a GitHub account if you do not already have one.
2. Create a **new repository** named `socialscope`. You can make the source public if you want others to inspect or contribute to the code. Never put API keys, passwords, OAuth secrets or `.env` files in the repository.
3. Upload the contents of this project folder to the repository (the files should be at the repository root, including `server.js` and `render.yaml`).
4. Sign in to Render and choose **New → Blueprint**.
5. Connect GitHub, select the `socialscope` repository, and follow the prompts. Render reads `render.yaml` and creates the web service.
6. When Render asks for `YOUTUBE_API_KEY`, enter your own YouTube Data API v3 key in the service's environment settings. Keep it private; do not add it to GitHub.
7. Wait for the deployment to finish. Open the `onrender.com` URL shown in the Render dashboard.
8. Check `https://YOUR-SERVICE.onrender.com/api/health`. It should return JSON with `ok: true`.

Render's free plan and availability can change. Review Render's current pricing and limits before relying on the site for ongoing public use. A free service may sleep when idle and take a little longer to respond on its first visit.

## Run locally

- Install Node.js 18 or newer.
- Copy `.env.example` to `.env`.
- Add your API key after `YOUTUBE_API_KEY=`.
- Run `npm start` in this folder.
- Visit `http://localhost:3000`.

No npm packages are required.

## YouTube API setup

In Google Cloud Console:
1. Create or select a project.
2. Enable **YouTube Data API v3**.
3. Create an API key.
4. Restrict the key to the YouTube Data API where practical.
5. For Render, add the key as the `YOUTUBE_API_KEY` environment variable in the service settings. For local use, put it in `.env`.

The API has quota limits and may return errors if the quota is exhausted or comments are disabled for a video.

## Data storage

Profile snapshots are stored in each visitor's browser `localStorage`. They are not uploaded to a database. Clearing browser site data or using another browser/device will remove or separate this history.

## Before inviting the public

- Add a privacy notice and contact method.
- Explain what data is queried and what is stored locally.
- Keep API keys and OAuth secrets in host environment variables.
- Add rate limiting and abuse monitoring before expecting significant traffic.
- Do not add scraping or features intended to uncover private personal information.
