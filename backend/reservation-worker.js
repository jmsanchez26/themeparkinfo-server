require("dotenv").config();

const { initializeFirebaseMessaging } = require("./lib/firebaseMessaging");
const { startReservationWorker, RESERVATION_CHECK_INTERVAL_MS } = require("./lib/reservationWorker");

async function main() {
  const messaging = initializeFirebaseMessaging();

  console.log(`Reservation worker starting. Interval: ${Math.round(RESERVATION_CHECK_INTERVAL_MS / 60000)} minutes.`);
  startReservationWorker({ messaging, log: console });
}

main().catch(error => {
  console.error("Reservation worker failed to start:", error);
  process.exit(1);
});
