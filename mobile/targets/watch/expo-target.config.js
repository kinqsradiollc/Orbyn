/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "watch",
  name: "OrbynWatch",
  displayName: "Orbyn",
  frameworks: ["SwiftUI", "WatchConnectivity"],
  colors: { $accent: "#376c51" },
  entitlements: {
    "com.apple.security.application-groups": config.ios?.entitlements?.[
      "com.apple.security.application-groups"
    ] ?? ["group.com.orbyn.planner"],
  },
  deploymentTarget: "10.0",
});
