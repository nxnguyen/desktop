// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {ipcMain as notMockedIpcMain, app as notMockedApp} from 'electron';
import {autoUpdater, type UpdateDownloadedEvent} from 'electron-updater';

import MessageModal from 'app/mainWindow/modals/messageModal';
import {
    CHECK_FOR_UPDATES,
    UPDATE_AVAILABLE,
    NO_UPDATE_AVAILABLE,
    UPDATE_SHORTCUT_MENU,
    DOWNLOAD_UPDATE_MANUALLY,
} from 'common/communication';
import Config from 'common/config';
import DownloadsManager from 'main/downloadsManager';
import {localizeMessage} from 'main/i18nManager';
import NotificationManager from 'main/notifications';

import {UpdateNotifier} from './updateNotifier';

const ipcMain = jest.mocked(notMockedIpcMain);
const app = jest.mocked(notMockedApp);

jest.mock('electron', () => ({
    app: {
        getAppPath: jest.fn(() => '/path/to/app'),
        getVersion: jest.fn(() => '5.0.0'),
        name: 'Mattermost',
    },
    ipcMain: {
        on: jest.fn(),
        emit: jest.fn(),
        handle: jest.fn(),
    },
    shell: {
        openExternal: jest.fn(),
    },
    net: {
        fetch: jest.fn(),
    },
}));

jest.mock('common/config', () => ({
    canUpgrade: true,
}));

jest.mock('common/config/buildConfig', () => ({
    updateNotificationURL: 'https://updates.152.42.230.207.sslip.io/desktop/stable',
}));

jest.mock('main/notifications', () => ({
    displayUpgrade: jest.fn(),
}));

jest.mock('main/i18nManager', () => ({
    localizeMessage: jest.fn((key: string, defaultValue: string) => defaultValue),
}));

jest.mock('common/log', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    })),
}));

jest.mock('electron-is-dev', () => ({
    __esModule: true,
    default: false,
}));

jest.mock('electron-updater', () => {
    const {EventEmitter} = jest.requireActual('events');
    const driver = Object.assign(new EventEmitter(), {
        checkForUpdates: jest.fn(),
        downloadUpdate: jest.fn(),
        quitAndInstall: jest.fn(),
        netSession: {webRequest: {onBeforeRequest: jest.fn()}},
    });
    return {
        autoUpdater: driver,
        AppImageUpdater: class {
            constructor() {
                return driver;
            }
        },
    };
});

jest.mock('main/downloadsManager', () => ({
    removeUpdateBeforeRestart: jest.fn(),
    setAppUpdateState: jest.fn(),
}));

jest.mock('app/mainWindow/modals/messageModal', () => ({
    __esModule: true,
    default: {
        showMessageModal: jest.fn(),
    },
}));

describe('main/updateNotifier', () => {
    let savedAppImage: string | undefined;
    let chdir: jest.SpyInstance;
    beforeEach(() => {
        savedAppImage = process.env.APPIMAGE;
        process.env.APPIMAGE = '/tmp/fixture.AppImage';
        chdir = jest.spyOn(process, 'chdir').mockImplementation(() => {});
    });
    afterEach(() => {
        chdir.mockRestore();
        if (savedAppImage === undefined) {
            delete process.env.APPIMAGE;
        } else {
            process.env.APPIMAGE = savedAppImage;
        }
    });

    describe('constructor', () => {
        afterEach(() => {
            jest.resetAllMocks();
        });

        it('should register IPC listeners', () => {
            const updateNotifier = new UpdateNotifier();
            expect(updateNotifier).toBeDefined();
            expect(ipcMain.on).toHaveBeenCalledWith(CHECK_FOR_UPDATES, expect.any(Function));
        });

        it('should check for updates when CHECK_FOR_UPDATES is emitted', () => {
            let checkCallback: (() => void) | undefined;
            ipcMain.on.mockImplementation((event, callback) => {
                if (event === CHECK_FOR_UPDATES) {
                    checkCallback = callback as () => void;
                }
                return ipcMain;
            });

            const updateNotifier = new UpdateNotifier();
            updateNotifier.checkForUpdates = jest.fn();
            checkCallback?.();

            expect(updateNotifier.checkForUpdates).toHaveBeenCalledWith(true);
        });
    });

    describe('onUpdateAvailable', () => {
        it('should set version and notify', () => {
            const updateNotifier = new UpdateNotifier();
            updateNotifier.notify = jest.fn();

            updateNotifier.onUpdateAvailable({version: '5.1.0'});

            expect(updateNotifier.versionAvailable).toBe('5.1.0');
            expect(ipcMain.emit).toHaveBeenCalledWith(UPDATE_SHORTCUT_MENU);
            expect(updateNotifier.notify).toHaveBeenCalled();
        });
    });

    describe('notify', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.clearAllTimers();
            jest.useRealTimers();
        });

        it('should schedule next notification', () => {
            const updateNotifier = new UpdateNotifier();
            updateNotifier.notifyUpgrade = jest.fn();
            updateNotifier.notify();
            expect(updateNotifier.lastNotification).toBeDefined();
            if (updateNotifier.lastNotification) {
                clearTimeout(updateNotifier.lastNotification);
            }
        });

        it('should display upgrade notification when version is available', () => {
            const updateNotifier = new UpdateNotifier();
            updateNotifier.versionAvailable = '5.1.0';
            updateNotifier.notify();

            expect(ipcMain.emit).toHaveBeenCalledWith(UPDATE_AVAILABLE, null, '5.1.0');
            expect(NotificationManager.displayUpgrade).toHaveBeenCalledWith('5.1.0', expect.any(Function));
        });
    });

    describe('checkForUpdates', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.resetAllMocks();
            jest.clearAllTimers();
            jest.useRealTimers();
        });

        it('should return early if updates are disabled', () => {
            const Config = require('common/config');
            Config.canUpgrade = false;

            const updateNotifier = new UpdateNotifier();
            const performUpdateCheckSpy = jest.spyOn(updateNotifier, 'performUpdateCheck');
            updateNotifier.checkForUpdates(true);

            expect(performUpdateCheckSpy).not.toHaveBeenCalled();

            Config.canUpgrade = true;
            performUpdateCheckSpy.mockRestore();
        });

        it('should call performUpdateCheck and handle update available', async () => {
            const updateNotifier = new UpdateNotifier();
            updateNotifier.onUpdateAvailable = jest.fn();
            jest.spyOn(updateNotifier, 'performUpdateCheck').mockResolvedValue({version: '5.1.0'});

            updateNotifier.checkForUpdates(true);
            await Promise.resolve();

            expect(updateNotifier.performUpdateCheck).toHaveBeenCalledWith(true);
            expect(updateNotifier.onUpdateAvailable).toHaveBeenCalledWith({version: '5.1.0'});
        });

        it('should emit NO_UPDATE_AVAILABLE when no update is found', async () => {
            const updateNotifier = new UpdateNotifier();
            updateNotifier.displayNoUpgrade = jest.fn();
            jest.spyOn(updateNotifier, 'performUpdateCheck').mockResolvedValue(null);

            updateNotifier.checkForUpdates(true);
            await Promise.resolve();

            expect(ipcMain.emit).toHaveBeenCalledWith(NO_UPDATE_AVAILABLE);
            expect(updateNotifier.displayNoUpgrade).toHaveBeenCalled();
        });

        it('should schedule next check', () => {
            const updateNotifier = new UpdateNotifier();
            jest.spyOn(updateNotifier, 'performUpdateCheck').mockResolvedValue(null);
            const checkForUpdatesSpy = jest.spyOn(updateNotifier, 'checkForUpdates');
            updateNotifier.checkForUpdates(false);
            jest.advanceTimersByTime(3600000);
            expect(checkForUpdatesSpy).toHaveBeenCalledTimes(2);
        });
    });

    describe('performUpdateCheck', () => {
        beforeEach(() => {
            jest.resetAllMocks();
        });

        it('should return update info', async () => {
            app.getVersion.mockReturnValue('5.0.0');
            jest.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
                isUpdateAvailable: true,
                updateInfo: {version: '6.1.0-develop.2'},
            } as Awaited<ReturnType<typeof autoUpdater.checkForUpdates>>);
            const updateNotifier = new UpdateNotifier();
            const result = await updateNotifier.performUpdateCheck(false);
            expect(result).toEqual({version: '6.1.0-develop.2'});
        });
    });

    describe('download and restart consent', () => {
        const downloadedUpdate: UpdateDownloadedEvent = {
            version: '6.4.1', files: [], path: '', sha512: '', releaseDate: '', downloadedFile: '/cache/update.zip',
        };

        beforeEach(() => {
            jest.useFakeTimers();
            autoUpdater.removeAllListeners();
            Object.assign(Config, {canUpgrade: true});
            jest.mocked(localizeMessage).mockImplementation((key, defaultValue) => defaultValue || key);
            app.getVersion.mockReturnValue('6.4.0');
            jest.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
                isUpdateAvailable: true,
                updateInfo: {version: '6.4.1'},
            } as Awaited<ReturnType<typeof autoUpdater.checkForUpdates>>);
            jest.mocked(autoUpdater.downloadUpdate).mockResolvedValue([]);
            jest.mocked(MessageModal.showMessageModal).mockResolvedValue({response: 0} as Awaited<ReturnType<typeof MessageModal.showMessageModal>>);
        });

        afterEach(() => {
            autoUpdater.removeAllListeners();
            jest.clearAllTimers();
            jest.useRealTimers();
            jest.resetAllMocks();
            Object.assign(Config, {canUpgrade: true});
        });

        const clickDownload = async () => {
            const listener = ipcMain.on.mock.calls.find(([channel]) => channel === DOWNLOAD_UPDATE_MANUALLY)?.[1];
            expect(listener).toBeDefined();
            await listener?.({} as Electron.IpcMainEvent);
        };

        it('rechecks a persisted update on an explicit download click after app restart', async () => {
            const notifier = new UpdateNotifier();
            expect(notifier.versionAvailable).toBeUndefined();
            await clickDownload();
            expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
            expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
            expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
        });

        it('keeps a downloaded update after Later and requires a separate restart choice', async () => {
            const notifier = new UpdateNotifier();
            expect(notifier).toBeDefined();
            await clickDownload();
            autoUpdater.emit('update-downloaded', downloadedUpdate);
            await Promise.resolve();
            expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
            expect(MessageModal.showMessageModal).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining('downloaded'), defaultId: 0, cancelId: 0,
            }));
            jest.mocked(MessageModal.showMessageModal).mockResolvedValueOnce({response: 1} as Awaited<ReturnType<typeof MessageModal.showMessageModal>>);
            await clickDownload();
            expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
        });

        it('describes Linux install without promising a later native signature check', async () => {
            const platform = process.platform;
            Object.defineProperty(process, 'platform', {value: 'linux'});
            try {
                const notifier = new UpdateNotifier();
                expect(notifier).toBeDefined();
                await clickDownload();
                autoUpdater.emit('update-downloaded', downloadedUpdate);
                await Promise.resolve();
                expect(MessageModal.showMessageModal).toHaveBeenCalledWith(expect.objectContaining({
                    message: 'The update has downloaded. Restart Amobi Collab to install it.',
                    defaultId: 0,
                    cancelId: 0,
                }));
                expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
            } finally {
                Object.defineProperty(process, 'platform', {value: platform});
            }
        });

        it('does not download a persisted candidate excluded by native update checks', async () => {
            const notifier = new UpdateNotifier();
            expect(notifier).toBeDefined();
            jest.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
                isUpdateAvailable: false, updateInfo: {version: '6.4.1'},
            } as Awaited<ReturnType<typeof autoUpdater.checkForUpdates>>);
            await clickDownload();
            expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
            expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
        });

        it('preserves the downloaded row when the daily reminder fires', async () => {
            const notifier = new UpdateNotifier();
            await clickDownload();
            autoUpdater.emit('update-downloaded', downloadedUpdate);
            ipcMain.emit.mockClear();
            notifier.notifyUpgrade();
            expect(ipcMain.emit).not.toHaveBeenCalledWith(UPDATE_AVAILABLE, null, '6.4.1');
        });

        it('shows one error and allows retry after native signature verification fails', async () => {
            const notifier = new UpdateNotifier();
            expect(notifier).toBeDefined();
            await clickDownload();
            autoUpdater.emit('update-downloaded', downloadedUpdate);
            await Promise.resolve();
            jest.mocked(MessageModal.showMessageModal).mockResolvedValueOnce({response: 1} as Awaited<ReturnType<typeof MessageModal.showMessageModal>>);
            await clickDownload();
            jest.mocked(MessageModal.showMessageModal).mockClear();
            autoUpdater.emit('error', new Error('Squirrel signature verification failed'));
            expect(DownloadsManager.setAppUpdateState).toHaveBeenLastCalledWith('interrupted', '6.4.1', undefined);
            expect(MessageModal.showMessageModal).toHaveBeenCalledTimes(1);
            await clickDownload();
            expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(2);
        });

        it('rechecks upgrade policy after the user answers the restart prompt', async () => {
            const notifier = new UpdateNotifier();
            expect(notifier).toBeDefined();
            await clickDownload();
            let answer: (result: {response: number; checkboxChecked: boolean}) => void = () => {};
            jest.mocked(MessageModal.showMessageModal).mockImplementationOnce(() => new Promise((resolve) => {
                answer = resolve;
            }));
            autoUpdater.emit('update-downloaded', downloadedUpdate);
            Object.assign(Config, {canUpgrade: false});
            answer({response: 1, checkboxChecked: false});
            await Promise.resolve();
            expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
        });

        it('does not download if policy is disabled while refreshing a persisted candidate', async () => {
            const notifier = new UpdateNotifier();
            expect(notifier).toBeDefined();
            jest.mocked(autoUpdater.checkForUpdates).mockImplementationOnce(async () => {
                Object.assign(Config, {canUpgrade: false});
                return {
                    isUpdateAvailable: true, updateInfo: {version: '6.4.1'},
                } as Awaited<ReturnType<typeof autoUpdater.checkForUpdates>>;
            });
            await clickDownload();
            expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
        });

        it('clears a stale version and its reminder when a manual recheck finds no update', async () => {
            const notifier = new UpdateNotifier();
            notifier.versionAvailable = '6.4.1';
            notifier.notify();
            jest.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
                isUpdateAvailable: false, updateInfo: {version: '6.4.1'},
            } as Awaited<ReturnType<typeof autoUpdater.checkForUpdates>>);
            const check = jest.spyOn(notifier, 'performUpdateCheck');
            notifier.checkForUpdates(true);
            await check.mock.results[0].value;
            expect(notifier.versionAvailable).toBeUndefined();
            expect(notifier.lastNotification).toBeUndefined();
        });
    });
});
