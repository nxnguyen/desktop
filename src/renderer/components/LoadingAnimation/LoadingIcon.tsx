// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import amobiIcon from 'assets/linux/app_icon.png';

export default function LoadingIcon() {
    return (
        <svg width='104' height='104' viewBox='0 0 104 104' role='img' aria-label='Amobi Collab'>
            <g className='LoadingAnimation__compass'>
                <image href={amobiIcon} width='104' height='104'/>
            </g>
        </svg>
    );
}
