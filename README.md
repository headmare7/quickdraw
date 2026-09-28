# QuickDraw — Multiplayer Reaction Battle

Small 2-player browser game for the Handshake AI Skills Studio "Create a Multiplayer Game" mission.

## MVP
- No login
- 2 players per room
- 4-character room codes
- Server-authoritative reaction timing and scoring
- 5 rounds
- False-start rule
- Round and final results
- Replay
- Disconnect and invalid-room handling
- Responsive mobile/desktop UI
- No database or external packages required for the preview

## Run locally

Requires Node.js 18+.

```bash
node server/index.js
```

Open:

```text
http://localhost:3000
```

The server listens on `0.0.0.0:3000`, so a second device on the same Wi-Fi can use the computer's LAN IP:

```text
http://YOUR_COMPUTER_LAN_IP:3000
```

## Two-device test

1. Start the server on the laptop/desktop.
2. Open `http://localhost:3000` on the laptop.
3. Enter a name and select **Create Room**.
4. Copy the 4-character room code.
5. On a phone connected to the same Wi-Fi, open `http://YOUR_COMPUTER_LAN_IP:3000`.
6. Enter a different name and the room code, then select **Join**.
7. On the laptop, select **Start Game**.
8. On both devices, verify the same round number and synchronized `GET READY` / `DRAW!` state.
9. Tap after `DRAW!` on both devices. Confirm the faster server-recorded reaction gets the point on both screens.
10. Repeat until 5 rounds finish. Confirm the final score and winner are identical on both devices.
11. Select **Play Again** and verify a fresh 5-round game starts with scores reset.
12. Refresh/close one device during the lobby or game and verify the remaining player sees the disconnect message and returns to the lobby state.
13. Try an invalid room code on another browser/device and verify **Room not found** appears.
14. During a round, tap before `DRAW!` and verify **False start** is shown and the opponent can win that round.

### If the phone cannot connect
- Confirm both devices are on the same Wi-Fi network.
- On Windows, allow Node.js through the private-network firewall prompt if shown.
- Find the laptop LAN IPv4 address with `ipconfig` and use that address, not `localhost`.
- Make sure port `3000` is not blocked by the firewall.

## Server authority

The browser only sends intent (`reaction` or `false_start`). The server records the draw timestamp, calculates reaction time, validates false starts, awards points, advances rounds, and determines the final winner.
