// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import amobiIcon from 'assets/linux/app_icon.png';

type Props = {width?: number; height?: number};

export default function AmobiLogo({width = 206, height = 36}: Props) {
    return (
        <svg width={width} height={height} viewBox='0 0 206 36' role='img' aria-label='Amobi Collab'>
            <image href={amobiIcon} width='36' height='36'/>
            <text x='46' y='25' fontSize='22' fontWeight='600' fontFamily='Open Sans, sans-serif' fill='currentColor'>
                {'Amobi Collab'}
            </text>
        </svg>
    );
}
