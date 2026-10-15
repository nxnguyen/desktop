// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {EventEmitter} from 'events';

import type {AppUpdater} from 'electron-updater';

import {SelfHostedUpdater} from './selfHostedUpdater';

jest.mock('electron', () => ({app: {getVersion: () => '6.4.0'}}));
jest.mock('electron-updater', () => ({autoUpdater: {}}));

function fixture(version = '6.4.1') {
    const driver = Object.assign(new EventEmitter(), {
        checkForUpdates: jest.fn().mockResolvedValue({isUpdateAvailable: true, updateInfo: {version}}),
        downloadUpdate: jest.fn().mockResolvedValue([]),
        quitAndInstall: jest.fn(),
        autoDownload: true,
        autoInstallOnAppQuit: true,
        allowDowngrade: true,
        netSession: {webRequest: {onBeforeRequest: jest.fn()}},
    });
    const onState = jest.fn();
    const updater = new SelfHostedUpdater(onState, driver as unknown as AppUpdater);
    return {updater, driver, onState};
}

describe('self hosted desktop updater', () => {
    it('checks for a new version without downloading or installing it', async () => {
        const {updater, driver} = fixture();
        await expect(updater.check()).resolves.toEqual({version: '6.4.1'});
        expect(driver.autoDownload).toBe(false);
        expect(driver.autoInstallOnAppQuit).toBe(false);
        expect(driver.allowDowngrade).toBe(false);
        expect(driver.downloadUpdate).not.toHaveBeenCalled();
        expect(updater.install()).toBe(false);
    });

    it('does not offer a downgrade or malformed release', async () => {
        await expect(fixture('6.3.9').updater.check()).resolves.toBeNull();
        await expect(fixture('not-a-version').updater.check()).rejects.toThrow('valid version');
    });

    it('requires a completed download and explicit install consent', async () => {
        const {updater, driver, onState} = fixture();
        await updater.check();
        await updater.download();
        expect(updater.install()).toBe(false);
        driver.emit('update-downloaded', {version: '6.4.1'});
        expect(onState).toHaveBeenLastCalledWith('completed', '6.4.1', 100);
        expect(driver.quitAndInstall).not.toHaveBeenCalled();
        expect(updater.install()).toBe(true);
        expect(driver.quitAndInstall).toHaveBeenCalledWith(false, true);
    });

    it('retains a downloaded update across rechecks', async () => {
        const {updater, driver} = fixture();
        await updater.check();
        driver.emit('update-downloaded', {version: '6.4.1'});
        await updater.check();
        expect(driver.checkForUpdates).toHaveBeenCalledTimes(1);
        expect(updater.isReady()).toBe(true);
    });

    it('keeps a failed verification uninstalled and allows retry', async () => {
        const {updater, driver, onState} = fixture();
        await updater.check();
        driver.downloadUpdate.mockRejectedValueOnce(new Error('signature invalid'));
        await expect(updater.download()).rejects.toThrow('signature invalid');
        expect(onState).toHaveBeenLastCalledWith('interrupted', '6.4.1');
        expect(updater.install()).toBe(false);
        await updater.download();
        expect(driver.downloadUpdate).toHaveBeenCalledTimes(2);
    });

    it('honors native platform and rollout exclusions for a newer version', async () => {
        const {updater, driver} = fixture();
        driver.checkForUpdates.mockResolvedValue({isUpdateAvailable: false, updateInfo: {version: '6.4.1'}});
        await expect(updater.check()).resolves.toBeNull();
        await updater.download();
        expect(driver.downloadUpdate).not.toHaveBeenCalled();
    });

    it('returns no update when the native updater is inactive', async () => {
        const {updater, driver} = fixture();
        driver.checkForUpdates.mockResolvedValue(null as never);
        await expect(updater.check()).resolves.toBeNull();
    });

    it('clears a downloaded candidate when native install verification fails', async () => {
        const {updater, driver, onState} = fixture();
        await updater.check();
        driver.emit('update-downloaded', {version: '6.4.1'});
        expect(updater.install()).toBe(true);
        expect(updater.install()).toBe(false);
        driver.emit('error', new Error('Squirrel signature verification failed'));
        expect(updater.isReady()).toBe(false);
        expect(onState).toHaveBeenLastCalledWith('interrupted', '6.4.1');
        await updater.download();
        expect(driver.downloadUpdate).toHaveBeenCalledTimes(1);
    });

    it('reports a native download failure once when it emits and rejects', async () => {
        const {updater, driver, onState} = fixture();
        await updater.check();
        driver.downloadUpdate.mockImplementation(async () => {
            driver.emit('error', new Error('signature invalid'));
            throw new Error('signature invalid');
        });
        await expect(updater.download()).rejects.toThrow('signature invalid');
        expect(onState.mock.calls.filter(([state]) => state === 'interrupted')).toHaveLength(1);
    });

    it('blocks insecure and foreign updater requests, including redirect destinations', async () => {
        const {updater, driver} = fixture();
        await updater.check();
        const [, onRequest] = driver.netSession.webRequest.onBeforeRequest.mock.calls[0];
        for (const [url, cancel] of [
            ['https://updates.152.42.230.207.sslip.io/desktop/stable/mac/arm64/latest-mac.yml', false],
            ['https://updates.152.42.230.207.sslip.io/desktop/qa/mac/arm64/qa-mac.yml', false],
            ['http://updates.152.42.230.207.sslip.io/file.zip', true],
            ['https://foreign.example/file.zip', true],
            ['https://user:password@updates.152.42.230.207.sslip.io/file.zip', true],
        ]) {
            const callback = jest.fn();
            onRequest({url}, callback);
            expect(callback).toHaveBeenCalledWith({cancel});
        }
    });

    it.each([
        'http://updates.152.42.230.207.sslip.io/file.zip',
        'https://foreign.example/file.zip',
    ])('rejects untrusted artifact metadata before downloading: %s', async (url) => {
        const {updater, driver} = fixture();
        driver.checkForUpdates.mockResolvedValue({isUpdateAvailable: true, updateInfo: {version: '6.4.1', files: [{url}]}});
        await expect(updater.check()).rejects.toThrow('untrusted download URL');
        await updater.download();
        expect(driver.downloadUpdate).not.toHaveBeenCalled();
    });
});
