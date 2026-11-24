/*
 * IRIS settings. This is the ONLY file you edit before uploading.
 * It is public. It must never hold passwords, keys, case data or anything private.
 * - API_URL: the web app address you copy from Apps Script (it ends in /exec).
 * - FIREBASE and VAPID_KEY: the public web settings from your Firebase project. Leave them empty if you
 *   do not want phone alerts yet. Alerts inside the app work without them.
 */
window.IRIS_CONFIG = {
  API_URL: '',
  FIREBASE: { apiKey: '', authDomain: '', projectId: '', messagingSenderId: '', appId: '' },
  VAPID_KEY: '',
  APP_CODE: 'iris'
};
