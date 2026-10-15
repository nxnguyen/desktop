// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
const semver = require('semver');

const pkg = require('./package.json');
const macAdhocQa = process.env.AMOBI_MAC_ADHOC_QA === 'true';
const requestedChannel = process.env.AMOBI_DESKTOP_CHANNEL || 'stable';
if (!['qa', 'stable'].includes(requestedChannel)) {
    throw new Error('AMOBI_DESKTOP_CHANNEL must be qa or stable');
}
if (macAdhocQa && process.env.AMOBI_DESKTOP_CHANNEL === 'stable') {
    throw new Error('Mac ad hoc builds cannot use the stable update channel');
}
const qaChannel = macAdhocQa || requestedChannel === 'qa';
const qaSuffix = qaChannel ? '-qa' : '';
const channelOutput = qaChannel ? 'release-qa' : 'release';

function getMacVersions() {
    const stableVersion = semver.coerce(pkg.version)?.version || pkg.version;
    let buildVersion = stableVersion;
    if (process.env.GITHUB_RUN_ID) {
        buildVersion = `${process.env.GITHUB_RUN_ID}${process.env.GITHUB_RUN_ATTEMPT || ''}`;
    } else {
        const match = pkg.version.match(/-[^.]+\.(\d+)$/);
        if (match) {
            buildVersion = match[1];
        }
    }
    return {bundleShortVersion: stableVersion, bundleVersion: buildVersion};
}

const config = {
    appId: 'com.amobi.collab.platform.desktop',
    artifactName: '${version}/amobi-collab-${version}-${os}-${arch}' + (macAdhocQa ? '-adhoc-qa' : qaSuffix) + '.${ext}',
    directories: {
        buildResources: 'src/assets',
        output: macAdhocQa ? 'release-adhoc-qa' : channelOutput,
    },
    extraMetadata: {
        main: 'index.js',
        name: 'amobi-collab-desktop',
    },
    publish: [{
        provider: 'generic',
        url: 'https://updates.152.42.230.207.sslip.io/desktop/' + (qaChannel ? 'qa' : 'stable') + '/${os}/${arch}',
        channel: qaChannel ? 'qa' : 'latest',
    }],
    files: [
        '!node_modules/**/*',
        'node_modules/bindings/**/*',
        'node_modules/file-uri-to-path/**/*',
        'node_modules/macos-notification-state/**/*',
        'node_modules/windows-focus-assist/**/*',
        'node_modules/registry-js/**/*',
        'node_modules/cf-prefs/**/*',
        'node_modules/@koromix/**/*',
        'node_modules/koffi/**/*',
        '!**/node_modules/macos-notification-state/bin/**/*',
        '!**/node_modules/macos-notification-state/build/**/*',
        '!**/node_modules/windows-focus-assist/bin/**/*',
        '!**/node_modules/windows-focus-assist/build/**/*',
        '!**/node_modules/registry-js/bin/**/*',
        '!**/node_modules/registry-js/build/**/*',
        '!**/node_modules/cf-prefs/bin/**/*',
        '!**/node_modules/cf-prefs/build/**/*',
        'node_modules/macos-notification-state/build/**/*.node',
        'node_modules/windows-focus-assist/build/Release/**/*.node',
        'node_modules/registry-js/build/Release/**/*.node',
        'node_modules/cf-prefs/build/Release/**/*.node',
        'node_modules/@koromix/**/*.node',
        {
            from: 'dist',
            to: '.',
            filter: '**/*',
        },
    ],
    protocols: [
        {
            name: 'Amobi Collab',
            schemes: [
                'mattermost',
            ],
        },
    ],
    beforePack: 'scripts/beforepack.js',
    afterPack: 'scripts/afterpack.js',
    deb: {
        artifactName: '${version}/${name}_${version}-1_${arch}.${ext}',
        synopsis: 'Amobi Collab Desktop App',
        depends: [
            'libnotify4',
            'libxtst6',
            'libnss3',
        ],
        priority: 'optional',
    },
    asarUnpack: [
        './node_modules/macos-notification-state/build/Release/**/*.node',
        './node_modules/windows-focus-assist/build/Release/**/*.node',
        './node_modules/registry-js/build/Release/**/*.node',
        './node_modules/cf-prefs/build/Release/**/*.node',
        './node_modules/@koromix/**/*.node',
    ],
    linux: {
        category: 'Network;InstantMessaging',
        target: [
            'deb',
            'tar.gz',
            'appimage',
            'rpm',
            'flatpak',
        ],
        appId: 'com.amobi.collab.platform.desktop',
        executableName: 'com.amobi.collab.platform.desktop',
        desktop: {
            entry: {
                StartupWMClass: pkg.desktopName,
            },
        },
        extraFiles: [
            {
                filter: [
                    'LICENSE.txt',
                    'NOTICE.txt',
                ],
            },
            {
                from: 'src/assets/linux',
                filter: [
                    'create_desktop_file.sh',
                    'app_icon.png',
                    'README.md',
                ],
            },
        ],
    },
    appImage: {
        executableArgs: [' '],
    },
    mac: {
        category: 'public.app-category.productivity',
        target: [
            'zip',
            'dmg',
        ],
        darkModeSupport: true,
        extraResources: [
            {
                filter: [
                    'LICENSE.txt',
                    'NOTICE.txt',
                ],
            },
        ],
        hardenedRuntime: true,
        gatekeeperAssess: true,
        entitlements: './resources/mac/entitlements.mac.plist',
        entitlementsInherit: './resources/mac/entitlements.mac.inherit.plist',

        // Local ad hoc QA has no provisioning profile or Developer ID team.
        // Keep these allowances scoped to explicitly requested QA artifacts.
        ...(macAdhocQa ? {
            identity: '-',
            notarize: false,
            gatekeeperAssess: false,
            entitlements: './resources/mac/entitlements.adhoc-qa.plist',
            entitlementsInherit: './resources/mac/entitlements.adhoc-qa.inherit.plist',
        } : {}),
        extendInfo: {
            NSMicrophoneUsageDescription: 'Microphone access is used to capture audio for voice communication and recordings.',
            NSCameraUsageDescription: 'Camera access is used to capture video for video conferencing and recordings.',
            NSFocusStatusUsageDescription: 'Focus status is used by Amobi Collab to determine whether to send notifications or not.',
            LSFileQuarantineEnabled: true,
        },
        x64ArchFiles: '**/node_modules/@koromix/koffi-darwin-*/darwin_*/koffi.node',
        ...getMacVersions(),
    },
    mas: {
        entitlements: './resources/mac/entitlements.mas.plist',
        entitlementsInherit: './resources/mac/entitlements.mas.inherit.plist',
        entitlementsLoginHelper: './resources/mac/entitlements.mas.inherit.plist',
        provisioningProfile: './mas.provisionprofile',
        extendInfo: {
            ITSAppUsesNonExemptEncryption: false,
            NSUserActivityTypes: ['INSendMessageIntent'],
        },
        singleArchFiles: '*',
        x64ArchFiles: '**/node_modules/@koromix/koffi-darwin-*/darwin_*/koffi.node',
    },
    masDev: {
        provisioningProfile: './dev.provisionprofile',
    },
    dmg: {
        background: 'src/assets/osx/DMG_BG.png',
        contents: [
            {
                x: 135,
                y: 165,
            },
            {
                x: 407,
                y: 165,
                type: 'link',
                path: '/Applications',
            },
        ],
        iconSize: 120,
        iconTextSize: 14,
        window: {
            height: 380,
        },
    },
    win: {
        target: [
            'zip',
            'msi',
            'nsis',
        ],
        verifyUpdateCodeSignature: true,
        signtoolOptions: {
            publisherName: process.env.AMOBI_WINDOWS_PUBLISHER || undefined,
        },
        extraFiles: [
            {
                filter: [
                    'LICENSE.txt',
                    'NOTICE.txt',
                ],
            },
            {
                from: 'resources/windows/gpo',
                to: 'gpo',
            },
        ],
        signExts: ['.dll', '.node'],
        azureSignOptions: process.env.AZURE_CLIENT_ID && process.env.AMOBI_AZURE_CERTIFICATE_PROFILE ? {
            certificateProfileName: process.env.AMOBI_AZURE_CERTIFICATE_PROFILE,
            codeSigningAccountName: process.env.AMOBI_AZURE_SIGNING_ACCOUNT,
            endpoint: process.env.AMOBI_AZURE_SIGNING_ENDPOINT,
            publisherName: process.env.AMOBI_WINDOWS_PUBLISHER,
        } : null,
    },
    msi: {
        additionalWixArgs: ['-ext', 'WixUtilExtension'],
        upgradeCode: '{91036C94-2621-52BD-B312-D0676913C52D}',
        perMachine: true,
    },
    rpm: {
        fpm: ['--rpm-rpmbuild-define', '_build_id_links none', '--rpm-digest=sha256'],
    },
    flatpak: {
        baseVersion: process.env.FLATPAK_BASE_VERSION || '25.08',
        runtimeVersion: process.env.FLATPAK_RUNTIME_VERSION || '25.08',
        useWaylandFlags: true,
    },
};

if (process.env.CI_MAC_ZIP_ONLY) {
    config.mac.target = ['zip'];
    config.mac.gatekeeperAssess = false;
}

module.exports = config;
