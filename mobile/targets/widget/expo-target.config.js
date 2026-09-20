/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "OrbynWidget",
  displayName: "Orbyn",
  frameworks: ["SwiftUI", "WidgetKit"],
  // The brand accent (matches the app palette in docs/mobile.md); the widget
  // references it as Color("accent"). Not a palette change — the same value.
  colors: { $accent: "#376c51" },
  // Share the App Group with the app so the widget can read the glance the app
  // writes. Mirrors app.json's ios.entitlements when present.
  entitlements: {
    "com.apple.security.application-groups": config.ios?.entitlements?.[
      "com.apple.security.application-groups"
    ] ?? ["group.com.orbyn.planner"],
  },
  deploymentTarget: "17.0",
});
