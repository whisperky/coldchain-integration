const FLEET = [
  {
    id: "863257063350583",
    name: "A571992",
    account: 478,
    shipment: "CL-13686/PHARMA-SHIP/COLD-LOGISTICS",
    from: [26.09891, -98.18494],
    to: [40.815468, -73.8805],
  },
  {
    id: "866088073468440",
    name: "B234567",
    account: 478,
    shipment: "INV-45678/VACCINE-BATCH",
    from: [42.3601, -71.0589],
    to: [33.749, -84.388],
  },
  {
    id: "866088073468444",
    name: "F678901",
    account: 999,
    shipment: "MW-20441/CLINICAL-SUPPLY",
    from: [41.8781, -87.6298],
    to: [44.9778, -93.265],
  },
] as const;

let lastTimestamp = 0;

export function generateReading() {
  const device = FLEET[Math.floor(Math.random() * FLEET.length)];
  // Whole seconds like Tive, and never repeated, so every run sends new readings.
  lastTimestamp = Math.max(Math.floor(Date.now() / 1000) * 1000, lastTimestamp + 1000);
  const progress = Math.random();
  const celsius = 2 + Math.random() * 6;
  const gps = Math.random() < 0.7;
  const meters = gps ? 3 + Math.floor(Math.random() * 10) : 20 + Math.floor(Math.random() * 40);
  const [x, y, z] = [(Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1, 1 + (Math.random() - 0.5) * 0.05];
  const dbm = -70 - Math.floor(Math.random() * 30);

  return {
    EntityName: device.name,
    EntryTimeEpoch: lastTimestamp,
    EntryTimeUtc: new Date(lastTimestamp).toISOString().replace(".000Z", "Z"),
    Cellular: { SignalStrength: dbm > -85 ? "Good" : "Fair", Dbm: dbm },
    Temperature: { Celsius: celsius, Fahrenheit: celsius * 1.8 + 32 },
    Humidity: { Percentage: 35 + Math.random() * 25 },
    Accelerometer: { G: Math.hypot(x, y, z), X: x, Y: y, Z: z },
    Light: { Lux: 0 },
    Battery: { Percentage: 40 + Math.floor(Math.random() * 60), Estimation: "Weeks", IsCharging: false },
    AccountId: device.account,
    DeviceId: device.id,
    DeviceName: device.name,
    ShipmentId: device.shipment,
    Location: {
      Latitude: device.from[0] + (device.to[0] - device.from[0]) * progress,
      Longitude: device.from[1] + (device.to[1] - device.from[1]) * progress,
      LocationMethod: gps ? "gps" : "wifi",
      Accuracy: { Meters: meters, Kilometers: meters / 1000, Miles: meters / 1609.344 },
      WifiAccessPointUsedCount: gps ? 0 : 5,
    },
  };
}
