try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
  importScripts(
    "https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js"
  );
} catch {
  // If Firebase scripts fail to load, skip push handling to avoid SW crash.
}

if (typeof firebase !== "undefined") {
  firebase.initializeApp({
    apiKey: "AIzaSyCkvQnuoLCNJGRsqr5KkExQC8e9AdN3Ncw",
    authDomain: "mdrst-elshmamsa1.firebaseapp.com",
    projectId: "mdrst-elshmamsa1",
    storageBucket: "mdrst-elshmamsa1.firebasestorage.app",
    messagingSenderId: "475353654295",
    appId: "1:475353654295:web:31fb8396eb646627292852",
  });
}

if (typeof firebase !== "undefined" && firebase.messaging) {
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title = payload?.notification?.title || "تنبيه جديد";
    const options = {
      body: payload?.notification?.body || "",
      icon: "/elmdrsa.jpeg",
      data: payload?.data || {},
    };
    self.registration.showNotification(title, options);
  });
}
