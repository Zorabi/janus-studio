import type { ForgeConfig } from "@electron-forge/shared-types";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";

const githubRepository = process.env.GITHUB_REPOSITORY?.split("/");
const windowsCertificate = process.env.WINDOWS_CERTIFICATE_FILE;
const macIdentity = process.env.MACOS_SIGN_IDENTITY;
const appleApiKey = process.env.APPLE_API_KEY;
const macSignConfig = process.platform === "darwin"
  ? {
      // Electron's bundled signature becomes invalid after Forge updates the
      // application metadata. Re-sign local builds ad hoc so their bundles are
      // internally valid; release builds replace this with Developer ID.
      osxSign: macIdentity
        ? { identity: macIdentity }
        : {
            identity: "-",
            identityValidation: false,
            // Hardened runtime's library validation requires a real Team ID.
            // Ad-hoc local builds intentionally have none. osx-sign applies
            // this setting per nested executable rather than at the root.
            optionsForFile: () => ({ hardenedRuntime: false }),
          },
      ...(macIdentity && appleApiKey && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER
        ? {
            osxNotarize: {
              appleApiKey,
              appleApiKeyId: process.env.APPLE_API_KEY_ID,
              appleApiIssuer: process.env.APPLE_API_ISSUER,
            },
          }
        : {}),
    }
  : {};

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appBundleId: "com.janusgraph.observatory",
    ...macSignConfig,
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      ...(windowsCertificate
        ? {
            certificateFile: windowsCertificate,
            certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
          }
        : {}),
    }),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  publishers: githubRepository?.length === 2
    ? [{
        name: "@electron-forge/publisher-github",
        config: {
          repository: { owner: githubRepository[0]!, name: githubRepository[1]! },
          prerelease: Boolean(process.env.JANUSGRAPH_PRERELEASE),
          draft: true,
        },
      }]
    : [],
};

export default config;
