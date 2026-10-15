// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState} from 'react';
import {FormattedMessage} from 'react-intl';

import type {DownloadedItem} from 'types/downloads';

import ThreeDotButton from '../ThreeDotButton';
import Thumbnail from '../Thumbnail';

type OwnProps = {
    activeItem?: DownloadedItem;
    item: DownloadedItem;
    appName: string;
}

const UpdateAvailable = ({item, appName, activeItem}: OwnProps) => {
    const [threeDotButtonVisible, setThreeDotButtonVisible] = useState(false);
    const downloading = item.state === 'progressing';
    const ready = item.state === 'completed';

    const handleMainButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        window.desktop.downloadUpdateManually();
    };

    const getMainButtonText = () => {
        if (downloading) {
            return (
                <FormattedMessage
                    id='renderer.downloadsDropdown.Update.Downloading'
                    defaultMessage='Downloading… {percent}%'
                    values={{percent: Math.round(item.progress)}}
                />
            );
        }
        if (ready) {
            return (
                <FormattedMessage
                    id='renderer.downloadsDropdown.Update.Restart'
                    defaultMessage='Restart to update'
                />
            );
        }
        if (item.state === 'interrupted') {
            return (
                <FormattedMessage
                    id='renderer.downloadsDropdown.Update.Retry'
                    defaultMessage='Retry download'
                />
            );
        }
        return (
            <FormattedMessage
                id='renderer.downloadsDropdown.Update.DownloadUpdate'
                defaultMessage='Download update'
            />
        );
    };

    return (
        <div
            className='DownloadsDropdown__Update'
            role='status'
            aria-live='polite'
            aria-atomic='true'
            onMouseEnter={() => setThreeDotButtonVisible(true)}
            onMouseLeave={() => setThreeDotButtonVisible(false)}
        >
            <Thumbnail item={item}/>
            <div className='DownloadsDropdown__Update__Details'>
                <div
                    className='DownloadsDropdown__Update__Details__Title'
                    id='update-available-title'
                >
                    {ready ? (
                        <FormattedMessage
                            id='renderer.downloadsDropdown.Update.Downloaded'
                            defaultMessage='Update downloaded'
                        />
                    ) : (
                        <FormattedMessage
                            id='renderer.downloadsDropdown.Update.NewDesktopVersionAvailable'
                            defaultMessage='New version available'
                        />
                    )}
                </div>
                <div
                    className='DownloadsDropdown__Update__Details__Description'
                    id='update-available-description'
                >
                    <FormattedMessage
                        id='renderer.downloadsDropdown.Update.ANewVersionIsAvailableToInstall'
                        defaultMessage='{appName} Desktop App version {version} is available to install.'
                        values={{
                            version: item.filename,
                            appName,
                        }}
                    />
                </div>
                <button
                    id='downloadUpdateButton'
                    className='primary-button DownloadsDropdown__Update__Details__Button'
                    onClick={handleMainButtonClick}
                    disabled={downloading}
                    aria-busy={downloading}
                    aria-labelledby='update-available-title downloadUpdateButton'
                    aria-describedby='update-available-description'
                >
                    {getMainButtonText()}
                </button>
            </div>
            <ThreeDotButton
                item={item}
                activeItem={activeItem}
                visible={threeDotButtonVisible && !downloading && !ready}
            />
        </div>
    );
};

export default UpdateAvailable;
