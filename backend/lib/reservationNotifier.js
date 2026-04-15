function buildReservationMatchBody(match) {
  return `${match.restaurant} has an opening on ${match.date} at ${match.time} for ${match.partySize} guests.`;
}

async function sendReservationNotifications(messaging, notifications) {
  if (!Array.isArray(notifications) || !notifications.length) {
    return { sent: 0, invalidTokens: [] };
  }

  if (!messaging) {
    console.warn("Reservation matches found, but Firebase is not configured.");
    return { sent: 0, invalidTokens: [] };
  }

  const invalidTokens = new Set();
  let sent = 0;

  const groupedByToken = new Map();
  notifications.forEach(notification => {
    const list = groupedByToken.get(notification.deviceToken) || [];
    list.push(notification);
    groupedByToken.set(notification.deviceToken, list);
  });

  await Promise.allSettled(
    [...groupedByToken.entries()].map(async ([deviceToken, items]) => {
      const first = items[0];
      const isSingle = items.length === 1;

      try {
        await messaging.send({
          token: deviceToken,
          notification: {
            title: isSingle ? first.match.restaurant : "Dining reservation found",
            body: isSingle
              ? buildReservationMatchBody(first.match)
              : `${items.length} dining reservation openings were found. Open the app for details.`
          },
          data: {
            source: "reservation-alert",
            provider: String(first.provider || ""),
            targetPath: "/pages/reservation-alerts.html"
          },
          android: {
            priority: "high"
          }
        });

        sent += items.length;
      } catch (error) {
        console.error(`Reservation push send failed for token ${deviceToken}:`, error.message);

        if (
          error.code === "messaging/registration-token-not-registered" ||
          error.code === "messaging/invalid-registration-token"
        ) {
          invalidTokens.add(deviceToken);
        }
      }
    })
  );

  return {
    sent,
    invalidTokens: [...invalidTokens]
  };
}

module.exports = {
  sendReservationNotifications
};
