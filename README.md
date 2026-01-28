# vedic-chart-backend

## Firebase Functions (Node.js) setup

### 1) Prerequisites
- Node.js 18
- Firebase CLI (`npm install -g firebase-tools`)
- A Firebase project (or create one in the Firebase console)

### 2) Configure the project
1. Update the Firebase project ID in `.firebaserc`.
2. Install dependencies:
   ```bash
   cd functions
   npm install
   ```

### 3) Run locally
```bash
cd functions
npm run serve
```
The emulator will expose the `helloVedic` function.

### 4) Deploy
```bash
cd functions
npm run deploy
```

### 5) Example function
The sample function is defined in `functions/index.js` and responds with JSON:
```json
{"message": "Namaste from Firebase Functions!"}
```

License
This project is licensed under the GNU AGPLv3.

Astro-Data Notice: This software utilizes the Swiss Ephemeris under the terms of the GNU Affero General Public License. In accordance with these terms, the source code for both this frontend and the associated backend calculations is made publicly available here.
