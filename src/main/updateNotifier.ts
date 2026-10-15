// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {app, ipcMain, shell} from 'electron';
import electronIsDev from 'electron-is-dev';

import MessageModal from 'app/mainWindow/modals/messageModal';
import {
    UPDATE_AVAILABLE,
    CHECK_FOR_UPDATES,
    UPDATE_SHORTCUT_MENU,
    NO_UPDATE_AVAILABLE,
    OPEN_WINDOWS_STORE,
    DOWNLOAD_UPDATE_MANUALLY,
    OPEN_UPDATE_GUIDE,
    OPEN_LINUX_GITHUB_RELEASE,
    GET_IS_MAC_APP_STORE,
    OPEN_MAC_APP_STORE,
    SKIP_VERSION,
} from 'common/communication';
import Config from 'common/config';
import buildConfig from 'common/config/buildConfig';
import {Logger} from 'common/log';
import downloadsManager from 'main/downloadsManager';
import {localizeMessage} from 'main/i18nManager';
import NotificationManager from 'main/notifications';
import {SelfHostedUpdater} from 'main/selfHostedUpdater';

const NEXT_NOTIFY = 86400000; // 24 hours
const NEXT_CHECK = 3600000; // 1 hour

const log = new Logger('UpdateNotifier');

interface UpdateInfo {
    version: string;
}

export class UpdateNotifier {
    lastNotification?: NodeJS.Timeout;
    lastCheck?: NodeJS.Timeout;
    versionAvailable?: string;
    private installPromptOpen = false;
    private nativeUpdater = new SelfHostedUpdater((state, version, progress) => {
        downloadsManager.setAppUpdateState(state, version, progress);
        if (state === 'completed') {
            this.promptRestart();
        } else if (state === 'interrupted') {
            this.displayUpdateError();
        }
    });

    constructor() {
        ipcMain.on(CHECK_FOR_UPDATES, () => this.checkForUpdates(true));
        ipcMain.on(OPEN_WINDOWS_STORE, this.openWindowsStore);
        ipcMain.on(DOWNLOAD_UPDATE_MANUALLY, this.downloadUpdateManually);
        ipcMain.on(OPEN_UPDATE_GUIDE, this.openUpdateGuide);
        ipcMain.on(OPEN_LINUX_GITHUB_RELEASE, this.openLinuxGitHubRelease);
        ipcMain.handle(GET_IS_MAC_APP_STORE, () => this.isMacAppStore());
        ipcMain.on(OPEN_MAC_APP_STORE, this.openMacAppStore);
        ipcMain.on(SKIP_VERSION, this.skipVersion);
    }

    onUpdateAvailable = (info: UpdateInfo): void => {
        this.versionAvailable = info.version;
        ipcMain.emit(UPDATE_SHORTCUT_MENU);
        log.info('New version available:', info.version);
        this.notify();
    };

    notify = (): void => {
        if (this.lastNotification) {
            clearTimeout(this.lastNotification);
        }
        this.lastNotification = setTimeout(this.notify, NEXT_NOTIFY);
        if (this.versionAvailable) {
            this.notifyUpgrade();
        }
    };

    notifyUpgrade = (): void => {
        if (!this.nativeUpdater.isReady() && !this.nativeUpdater.isDownloading()) {
            ipcMain.emit(UPDATE_AVAILABLE, null, this.versionAvailable);
        }
        NotificationManager.displayUpgrade(this.versionAvailable || 'unknown', this.handleDownloadLink);
    };

    handleDownloadLink = (): void => {
        log.info('User clicked update notification');
    };

    private clearUpdateNotification = () => {
        this.versionAvailable = undefined;
        if (this.lastNotification) {
            clearTimeout(this.lastNotification);
            this.lastNotification = undefined;
        }
        ipcMain.emit(NO_UPDATE_AVAILABLE);
    };

    displayNoUpgrade = (): void => {
        const version = app.getVersion();
        this.clearUpdateNotification();
        MessageModal.showMessageModal({
            title: app.name,
            message: localizeMessage('main.autoUpdater.noUpdate.message', 'You\'re up to date'),
            type: 'info',
            buttons: [localizeMessage('label.ok', 'OK')],
            detail: localizeMessage('main.autoUpdater.noUpdate.detail', 'You are using the latest version of the {appName} Desktop App (version {version}). You\'ll be notified when a new version is available to install.', {appName: app.name, version}),
        });
    };

    checkForUpdates = (manually: boolean): void => {
        if (!Config.canUpgrade) {
            log.info('update checks are disabled');
            return;
        }
        if (this.nativeUpdater.isReady()) {
            if (manually) {
                this.promptRestart();
            }
            return;
        }
        if (this.nativeUpdater.isDownloading()) {
            return;
        }
        if (this.lastCheck) {
            clearTimeout(this.lastCheck);
        }
        if (!this.lastNotification || manually) {
            this.performUpdateCheck(manually).then((updateInfo) => {
                if (updateInfo) {
                    const skippedVersions = Config.data?.skippedVersions || [];
                    if (!manually && skippedVersions.includes(updateInfo.version)) {
                        log.info('Version is skipped, not notifying', {version: updateInfo.version});
                        return;
                    }
                    this.onUpdateAvailable(updateInfo);
                } else {
                    this.clearUpdateNotification();
                    if (manually) {
                        this.displayNoUpgrade();
                    }
                }
            }).catch((reason) => {
                this.clearUpdateNotification();
                log.error('Failed to check for updates:', {reason});
                if (manually) {
                    this.displayUpdateError();
                }
            });
            this.lastCheck = setTimeout(() => this.checkForUpdates(false), NEXT_CHECK);
        }
    };

    performUpdateCheck = async (manually: boolean): Promise<UpdateInfo | null> => {
        log.info('Checking for updates', {manually});

        if (electronIsDev || this.isMacAppStore()) {
            log.info('In development mode, skipping update check');
            return null;
        }

        return this.nativeUpdater.check();
    };

    private openWindowsStore = (): void => {
        if (process.platform === 'win32' && buildConfig.windowsStoreUpdateURL) {
            shell.openExternal(buildConfig.windowsStoreUpdateURL);
        }
    };

    private openMacAppStore = (): void => {
        if (process.platform === 'darwin' && buildConfig.macAppStoreUpdateURL) {
            shell.openExternal(buildConfig.macAppStoreUpdateURL);
        }
    };

    private downloadUpdateManually = async (): Promise<void> => {
        if (!Config.canUpgrade) {
            return;
        }
        if (this.nativeUpdater.isReady()) {
            this.promptRestart();
            return;
        }
        try {
            // A persisted downloads row is only a hint. After an ordinary app
            // restart, refresh the native candidate before acting on this click.
            if (!this.nativeUpdater.hasUpdate()) {
                const info = await this.performUpdateCheck(true);
                if (!Config.canUpgrade) {
                    return;
                }
                if (!info) {
                    this.displayNoUpgrade();
                    return;
                }
                this.onUpdateAvailable(info);
            }
            await this.nativeUpdater.download();
        } catch {
            // Native download failures already publish an interrupted state.
            // A failed refresh has no download state to publish.
            if (!this.nativeUpdater.hasUpdate()) {
                this.displayUpdateError();
            }
        }
    };

    private displayUpdateError = () => MessageModal.showMessageModal({
        title: app.name,
        message: localizeMessage('main.autoUpdater.failed', 'The update could not be completed. Please try again.'),
        type: 'error',
        buttons: [localizeMessage('label.ok', 'OK')],
    });

    private promptRestart = async () => {
        if (!Config.canUpgrade || !this.nativeUpdater.isReady() || this.installPromptOpen) {
            return;
        }
        this.installPromptOpen = true;
        try {
            const message = process.platform === 'linux' ?
                localizeMessage('main.autoUpdater.downloadedLinux', 'The update has downloaded. Restart Amobi Collab to install it.') :
                localizeMessage('main.autoUpdater.downloaded', 'The update has downloaded. Restart Amobi Collab to verify and install it.');
            const result = await MessageModal.showMessageModal({
                title: app.name,
                message,
                type: 'info',
                buttons: [localizeMessage('label.later', 'Later'), localizeMessage('main.autoUpdater.restart', 'Restart to update')],
                defaultId: 0,
                cancelId: 0,
            });
            if (result.response === 1 && Config.canUpgrade) {
                this.nativeUpdater.install();
            }
        } finally {
            this.installPromptOpen = false;
        }
    };

    private openUpdateGuide = (): void => {
        if (process.platform === 'linux') {
            shell.openExternal(buildConfig.linuxUpdateURL);
        }
    };

    private openLinuxGitHubRelease = (): void => {
        if (!this.versionAvailable) {
            log.warn('No version available for GitHub release');
            return;
        }
        if (process.platform === 'linux') {
            const version = this.versionAvailable;
            const releaseURL = `${buildConfig.linuxGitHubReleaseURL}/v${version}`;
            shell.openExternal(releaseURL);
        }
    };

    private isMacAppStore = (): boolean => {
        // eslint-disable-next-line no-undef
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return Boolean(__IS_MAC_APP_STORE__);
    };

    private skipVersion = (): void => {
        if (!this.versionAvailable || this.nativeUpdater.isDownloading()) {
            log.warn('No version available to skip');
            return;
        }

        const versionToSkip = this.versionAvailable;
        this.nativeUpdater.skip();
        const skippedVersions = Config.data?.skippedVersions || [];

        if (skippedVersions.includes(versionToSkip)) {
            log.info('Version already skipped', {version: versionToSkip});
        } else {
            const updatedSkippedVersions = [...skippedVersions, versionToSkip];
            Config.set('skippedVersions', updatedSkippedVersions);
        }

        this.versionAvailable = undefined;
        if (this.lastNotification) {
            clearTimeout(this.lastNotification);
            this.lastNotification = undefined;
        }

        downloadsManager.removeUpdateBeforeRestart();
        ipcMain.emit(NO_UPDATE_AVAILABLE);
        log.info('Version skipped', {version: versionToSkip});
    };
}

const updateNotifier = new UpdateNotifier();
export default updateNotifier;
