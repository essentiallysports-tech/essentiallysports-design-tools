# Google Sheets Setup

The Design Request form now posts each successful request to:

`/api/design-request-submit`

That serverless function (deployed on Vercel from [api/design-request-submit.js](api/design-request-submit.js); the equivalent Netlify Function lives at [netlify/functions/design-request-submit.js](netlify/functions/design-request-submit.js)) appends a row to Google Sheets when these environment variables are set (in the Vercel project's Settings → Environment Variables, or Netlify's Site configuration → Environment variables):

```text
GOOGLE_SHEETS_ID=1zKanDaGLj8xy9dEOLZwQH5fdRuQiqgPvYtP0CegzufU
GOOGLE_SHEETS_RANGE=Sheet1!A:V
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account-name@project-id.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
```

`GOOGLE_SHEETS_RANGE` is optional if your tab is named `Sheet1`.

## Sheet Headers

The connected sheet currently uses the default tab named `Sheet1`. Row 1 has been set up with these headers:

```csv
Request ID,Created At,Status,Request Type,Requester Name,Requester Email,Department,Publication,Social Channel,Sport,Team or League,Title,Entities,Brief,Design Copy,Reference Links,Reference Files,Additional Notes,Priority,Design Needed By,Publish At,Source
```

## Google Access

1. Create or open the Google Sheet.
2. Create a Google Cloud service account.
3. Enable the Google Sheets API for that Google Cloud project.
4. Create a JSON key for the service account.
5. Share the Google Sheet with the service account email as an editor.
6. Add the JSON key values to the platform's environment variables:
   - `client_email` goes into `GOOGLE_SERVICE_ACCOUNT_EMAIL`.
   - `private_key` goes into `GOOGLE_PRIVATE_KEY`.

Keep the private key only in platform environment variables. Do not put it in `index.html`.

## Slack Design Request Notifications

The same serverless function can post a rich Design Request attachment to Slack. Add the incoming webhook as an environment variable:

```text
SLACK_DESIGN_REQUEST_WEBHOOK_URL=https://hooks.slack.com/services/...
```

The message includes the tracking ID, priority, request type, requester, publication/channel, title or entities, creative brief, design copy, notes, deadlines, references, and submission source.

Keep the webhook only in platform environment variables. Do not commit it to HTML, JavaScript, `vercel.json`, or `netlify.toml`. Rotate the webhook in Slack if it is ever exposed publicly.

## Email Design Request Notifications

The same serverless function can also POST the Design Request payload to the email notification endpoint. Add the endpoint as an environment variable:

```text
DESIGN_REQUEST_EMAIL_ENDPOINT=https://your-email-endpoint.example
```

Keep the endpoint server-side. Do not include it in browser JavaScript files or page markup.
