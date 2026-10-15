// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const builderPath = require.resolve('../electron-builder.ts');
const previousFlag = process.env.AMOBI_MAC_ADHOC_QA;
const previousChannel = process.env.AMOBI_DESKTOP_CHANNEL;
try {
    delete process.env.AMOBI_DESKTOP_CHANNEL;
    delete process.env.AMOBI_MAC_ADHOC_QA;
    delete require.cache[builderPath];
    // eslint-disable-next-line global-require
    const production = require(builderPath);
    assert.equal(production.mac.entitlements, './resources/mac/entitlements.mac.plist');
    assert.equal(production.mac.entitlementsInherit, './resources/mac/entitlements.mac.inherit.plist');
    assert.equal(production.directories.output, 'release');
    assert(!production.artifactName.includes('adhoc-qa'));
    assert.equal(production.publish[0].provider, 'generic');
    assert.equal(production.publish[0].channel, 'latest');
    assert(production.publish[0].url.endsWith('/desktop/stable/${os}/${arch}'));
    assert.equal(new URL(production.publish[0].url).protocol, 'https:');

    process.env.AMOBI_MAC_ADHOC_QA = 'true';
    delete require.cache[builderPath];
    // eslint-disable-next-line global-require
    const qa = require(builderPath);
    assert.equal(qa.mac.identity, '-');
    assert.equal(qa.mac.notarize, false);
    assert.equal(qa.mac.hardenedRuntime, true);
    assert.equal(qa.mac.entitlements, './resources/mac/entitlements.adhoc-qa.plist');
    assert.equal(qa.mac.entitlementsInherit, './resources/mac/entitlements.adhoc-qa.inherit.plist');
    assert.equal(qa.directories.output, 'release-adhoc-qa');
    assert(qa.artifactName.includes('-adhoc-qa.'));
    assert.equal(qa.publish[0].provider, 'generic');
    assert.equal(qa.publish[0].channel, 'qa');
    assert(qa.publish[0].url.endsWith('/desktop/qa/${os}/${arch}'));
    assert(!qa.publish[0].url.includes('/stable/'));
    for (const file of [qa.mac.entitlements, qa.mac.entitlementsInherit]) {
        const contents = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
        assert(contents.includes('com.apple.security.cs.disable-library-validation'));
        assert(!contents.includes('com.apple.developer.usernotifications.communication'));
    }
    for (const file of [production.mac.entitlements, production.mac.entitlementsInherit]) {
        assert(!fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8').includes('com.apple.security.cs.disable-library-validation'));
    }
    console.log('Mac QA packaging configuration checks passed');
} finally {
    if (previousChannel === undefined) {
        delete process.env.AMOBI_DESKTOP_CHANNEL;
    } else {
        process.env.AMOBI_DESKTOP_CHANNEL = previousChannel;
    }
    if (previousFlag === undefined) {
        delete process.env.AMOBI_MAC_ADHOC_QA;
    } else {
        process.env.AMOBI_MAC_ADHOC_QA = previousFlag;
    }
    delete require.cache[builderPath];
}
