// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

const assert = require('node:assert/strict');

const builderPath = require.resolve('../electron-builder.ts');
const savedChannel = process.env.AMOBI_DESKTOP_CHANNEL;
const savedAdhoc = process.env.AMOBI_MAC_ADHOC_QA;
function config(channel, adhoc) {
    delete require.cache[builderPath];
    if (channel === undefined) {
        delete process.env.AMOBI_DESKTOP_CHANNEL;
    } else {
        process.env.AMOBI_DESKTOP_CHANNEL = channel;
    }
    process.env.AMOBI_MAC_ADHOC_QA = adhoc ? 'true' : 'false';
    // eslint-disable-next-line global-require
    return require(builderPath);
}
try {
    const stable = config();
    assert.equal(stable.publish[0].channel, 'latest');
    assert(stable.publish[0].url.endsWith('/desktop/stable/${os}/${arch}'));
    assert.equal(stable.directories.output, 'release');
    assert(!stable.artifactName.includes('-qa.'));
    assert(stable.linux.target.some((target) => target.toLowerCase() === 'appimage'));
    const qa = config('qa');
    assert.equal(qa.publish[0].channel, 'qa');
    assert(qa.publish[0].url.endsWith('/desktop/qa/${os}/${arch}'));
    assert.equal(qa.directories.output, 'release-qa');
    assert(qa.artifactName.endsWith('-qa.${ext}'));
    assert.notEqual(qa.mac.identity, '-');
    assert.equal(config('qa', true).mac.identity, '-');
    assert.equal(config(undefined, true).publish[0].channel, 'qa');
    assert.throws(() => config('stable', true), /ad hoc/i);
    assert.throws(() => config('invalid'), /channel/i);
    console.log('Cross-platform updater channel checks passed');
} finally {
    for (const [name, value] of [['AMOBI_DESKTOP_CHANNEL', savedChannel], ['AMOBI_MAC_ADHOC_QA', savedAdhoc]]) {
        if (value === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = value;
        }
    }
    delete require.cache[builderPath];
}
