const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Yjs uses lib0's secure random source. Its native export depends on an
// uninstalled browser crypto polyfill; Expo supplies the native source instead.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform !== "web" &&
    moduleName === "lib0/webcrypto" &&
    /[/\\]lib0[/\\]random\.js$/.test(context.originModulePath)
  ) {
    return {
      type: "sourceFile",
      filePath: path.resolve(__dirname, "src/lib/native-random.ts"),
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
