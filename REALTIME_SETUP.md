# Christian Jam Time — shared room setup

The shared room code feature uses a Redis-compatible REST database so room state survives across Vercel serverless requests and can be shared by different devices.

## Vercel environment variables

Connect an Upstash Redis database (the free tier is sufficient for prototype testing) to the `christian-jam-time` Vercel project and make sure the project receives either of these variable pairs:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

or the compatible Vercel KV names:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

The application supports both naming schemes.

After adding the environment variables, redeploy the latest production deployment.

## Shared-room behaviour

- The leader creates a random `CJT-####` room.
- Other devices join with the room code.
- Presence is refreshed every 10 seconds; disconnected users disappear after roughly 35 seconds.
- The leader controls playlist, current song and key.
- Followers poll the shared room state every 1.5 seconds and automatically follow changes.
- Rooms expire after 12 hours.

This is the realtime prototype layer. Camera and microphone transport are deliberately separate and will be added after shared state is verified.
