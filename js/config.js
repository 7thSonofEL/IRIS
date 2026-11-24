/*
 * IRIS settings. This is the ONLY file you edit before uploading.
 * It is public. It must never hold passwords, keys, case data or anything private.
 * - API_URL: the web app address you copy from Apps Script (it ends in /exec).
 * - FIREBASE and VAPID_KEY: the public web settings from your Firebase project. Leave them empty if you
 *   do not want phone alerts yet. Alerts inside the app work without them.
 */
window.IRIS_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxBspuD5KS3YB1SB-n1UfcN5lE0292DHk2K29ausarJrLEGYG33dt8X4N63JReFabZmMA/exec',
  FIREBASE: { apiKey: '', authDomain: '', projectId: '', messagingSenderId: '', appId: '' },
  VAPID_KEY: '',
  APP_CODE: 'iris'
};
