// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import path from 'path';

import {app} from 'electron';
import {AppImageUpdater, autoUpdater, type AppUpdater} from 'electron-updater';
import semver from 'semver';

import buildConfig from 'common/config/buildConfig';

export type UpdateState = 'available' | 'progressing' | 'completed' | 'interrupted';
type StateListener = (state: UpdateState, version: string, percent?: number) => void;

/** Installer checks stay inside electron-updater; this controls consent.
 * On macOS, update-downloaded means the ZIP passed its checksum. Squirrel verifies
 * its signature only after the user explicitly chooses to install.
 * Linux AppImages use the HTTPS manifest checksum, not native package signatures.
 */
export class SelfHostedUpdater {
    private driver?: AppUpdater;
    private available?: string;
    private ready?: string;
    private downloading = false;
    private installing = false;
    private initialized = false;

    constructor(private onState: StateListener, driver?: AppUpdater) {
        this.driver = driver;
    }

    private getDriver = () => {
        this.driver ??= process.platform === 'linux' ? new AppImageUpdater() : autoUpdater;
        if (!this.initialized) {
            this.initialized = true;
            this.driver.autoDownload = false;
            this.driver.autoInstallOnAppQuit = false;
            this.driver.allowDowngrade = false;
            this.driver.disableWebInstaller = true;

            // This session serves internet requests only. Squirrel's authenticated
            // loopback transfer is separate and retains Electron's native checks.
            this.driver.netSession.webRequest.onBeforeRequest({urls: ['<all_urls>']}, (details, callback) => {
                callback({cancel: !this.isTrustedURL(details.url)});
            });
            this.driver.on('error', this.interrupt);
            this.driver.on('download-progress', ({percent}) => {
                if (this.available && this.downloading) {
                    this.onState('progressing', this.available, percent);
                }
            });
            this.driver.on('update-downloaded', ({version}) => {
                if (version === this.available) {
                    this.ready = version;
                    this.downloading = false;
                    this.onState('completed', version, 100);
                }
            });
        }
        return this.driver;
    };

    private isTrustedURL = (value: string) => {
        try {
            const url = new URL(value, `${buildConfig.updateNotificationURL}/`);
            return url.protocol === 'https:' && !url.username && !url.password &&
                url.origin === new URL(buildConfig.updateNotificationURL).origin;
        } catch {
            return false;
        }
    };

    private interrupt = () => {
        const active = this.downloading || this.installing || Boolean(this.ready);
        this.downloading = false;
        this.installing = false;
        this.ready = undefined;
        if (active && this.available) {
            this.onState('interrupted', this.available);
        }
    };

    check = async (): Promise<{version: string} | null> => {
        // Managed Linux formats use their package manager, outside this feed.
        if (process.platform === 'linux' && !process.env.APPIMAGE) {
            return null;
        }
        if (this.downloading || this.ready) {
            return this.available ? {version: this.available} : null;
        }
        this.available = undefined;
        const result = await this.getDriver().checkForUpdates();
        if (!result) {
            return null;
        }
        if (!semver.valid(result.updateInfo.version)) {
            throw new Error('Update service did not return a valid version');
        }
        const version = result.updateInfo.version;
        if (!result.isUpdateAvailable || !semver.gt(version, app.getVersion())) {
            return null;
        }
        const urls = (result.updateInfo.files || []).map((file) => file.url);
        if (result.updateInfo.path) {
            urls.push(result.updateInfo.path);
        }
        if (urls.some((url) => !this.isTrustedURL(url))) {
            throw new Error('Update service returned an untrusted download URL');
        }
        this.available = version;
        return {version};
    };

    download = async () => {
        if (!this.available || this.downloading || this.ready) {
            return;
        }
        this.downloading = true;
        this.onState('progressing', this.available, 0);
        try {
            await this.getDriver().downloadUpdate();
        } catch (error) {
            this.interrupt();
            throw error;
        }
    };

    hasUpdate = () => Boolean(this.available);

    isReady = () => Boolean(this.ready) && !this.installing;

    isDownloading = () => this.downloading || this.installing;

    install = () => {
        if (!this.ready || this.installing) {
            return false;
        }
        this.installing = true;
        try {
            if (process.platform === 'linux') {
                const appImage = process.env.APPIMAGE;
                if (!appImage || !path.isAbsolute(appImage) || appImage.includes('\0')) {
                    throw new Error('AppImage install path is unavailable');
                }

                // The old AppImage mount/extraction disappears on quit. Its
                // replacement must inherit a directory that survives that exit.
                process.chdir(path.dirname(appImage));
            }
            this.getDriver().quitAndInstall(false, true);
            return true;
        } catch {
            this.interrupt();
            return false;
        }
    };

    skip = () => {
        if (!this.isDownloading()) {
            this.available = undefined;
            this.ready = undefined;
        }
    };
}
