/* Prepare Apple components without running their installer-environment scripts.
 * The installer engine must execute the reviewed setup actions separately.
 * A prepared BaseSystemResources package is used only while its exact verified
 * Mavericks BaseSystem mount remains attached inside withComponents().
 */
var MavericksPackagePreparation = (function () {
    'use strict';
    var expectedNames = ['BaseSystemBinaries', 'BaseSystemResources', 'Essentials', 'BSD', 'JavaTools',
        'AdditionalEssentials', 'AdditionalSpeechVoices', 'AsianLanguagesSupport', 'MediaFiles',
        'JavaEssentials', 'OxfordDictionaries', 'X11redirect', 'OSInstall'].map(function (name) { return name + '.pkg'; });
    var source = typeof MavericksSourceImages !== 'undefined' ? MavericksSourceImages :
        typeof require !== 'undefined' ? require('./SourceImages.js') : null;
    function xmlEscape(text) {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }
    function catalogCheck(catalog) {
        if (!catalog || catalog.schema !== 1 || catalog.version !== '10.9.5' || catalog.build !== '13F34' ||
            catalog.externalRootToken !== '@@MAVERICKS_BASE_SYSTEM_ROOT@@' || !Array.isArray(catalog.packages) ||
            JSON.stringify(catalog.packages.map(function (p) { return p.name; })) !== JSON.stringify(expectedNames)) throw new Error('Invalid component package catalog.');
        catalog.packages.forEach(function (p) {
            if (!/^com\.apple\.pkg\.[A-Za-z0-9]+$/.test(p.identifier) || !/^[0-9.]+$/.test(p.version) ||
                !/^[a-f0-9]{64}$/.test(p.sourceSHA256) || !/^[a-f0-9]{64}$/.test(p.templateSHA256) ||
                p.template !== 'PackageInfo/' + p.name + '.xml' ||
                p.externalBaseSystem !== (p.name === 'BaseSystemResources.pkg')) throw new Error('Invalid component record.');
            var names = Object.keys(p.members);
            if (names.indexOf('PackageInfo') < 0 || names.some(function (n) { return ['PackageInfo', 'Bom', 'Payload', 'Scripts'].indexOf(n) < 0; })) throw new Error('Unexpected component members.');
            if (p.name === 'OSInstall.pkg') {
                if (p.version !== '10.9.0.1' || p.members.Bom || p.members.Payload || !p.members.Scripts || p.installedKiB !== 0) throw new Error('The setup-only package has unexpected contents.');
            } else if (!p.members.Bom || (!p.externalBaseSystem && !p.members.Payload)) throw new Error('A file-installing component is missing its payload or BOM.');
        });
    }
    function metadata(template, pkg, root, token) {
        if (typeof template !== 'string' || /<scripts\b|<relocate\b|relocatable="true"/.test(template)) throw new Error('Prepared metadata still contains automatic setup or relocation.');
        if (template.indexOf('identifier="' + pkg.identifier + '"') < 0 || template.indexOf('version="' + pkg.version + '"') < 0) throw new Error('Prepared package receipt identity differs.');
        var occurrences = template.split(token).length - 1;
        if (pkg.externalBaseSystem) {
            if (occurrences !== 1 || typeof root !== 'string' || root.charAt(0) !== '/' || root === '/' || /[\x00-\x1f]/.test(root)) throw new Error('Missing isolated Mavericks BaseSystem source.');
            if (template.indexOf('external-root="' + token + '"') < 0) throw new Error('External root token is outside its expected attribute.');
            return template.replace(token, xmlEscape(root));
        }
        if (occurrences || /external-root=/.test(template)) throw new Error('Unexpected external component source.');
        return template;
    }
    function checkMembers(io, directory, expected) {
        var names = Object.keys(expected).sort();
        if (JSON.stringify(io.directoryNames(directory).sort()) !== JSON.stringify(names)) throw new Error('Extracted component member list differs.');
        names.forEach(function (name) {
            var info = io.regularWithin(directory, name);
            if (info.bytes !== expected[name].bytes || io.sha256(directory + '/' + name) !== expected[name].sha256) throw new Error('Component member differs: ' + name);
        });
    }
    function scratchBytes(catalog,direct){
        catalogCheck(catalog);
        return Math.max.apply(null,catalog.packages.map(function(p){
            var members=Object.keys(p.members).filter(function(n){return n!=='Scripts';}).reduce(function(n,k){return n+p.members[k].bytes;},0);
            return direct?p.sourceBytes+members:p.sourceBytes*2+members*2;
        }))+2*1024*1024*1024;
    }
    function withComponents(io, frozen, job, catalog, sourceManifest, consume) {
        catalogCheck(catalog);
        if (!source || !frozen || ['frozen-mavericks-inputs','mounted-mavericks-inputs'].indexOf(frozen.kind)<0 || frozen.version !== '10.9.5' || frozen.build !== '13F34' ||
            typeof frozen.root !== 'string' || frozen.root.charAt(0) !== '/') throw new Error('Verified Mavericks source inputs are required.');
        source.validateManifest(sourceManifest);
        var baseEntry = sourceManifest.files.filter(function (e) { return e.path === 'System/Installation/BaseSystem.dmg'; })[0];
        var direct=frozen.kind==='mounted-mavericks-inputs',basePath;
        if(direct){io.assertReadOnlyImage(frozen.mount);basePath=frozen.root+'/'+baseEntry.path;}
        else{io.copyFile(frozen.root+'/'+baseEntry.path,job,'BaseSystem.dmg');basePath=job+'/BaseSystem.dmg';}
        if(direct){
            if(typeof frozen.verifiedFile!=='function')throw new Error('The read-only source must be verified before package preparation.');
            frozen.verifiedFile(basePath,baseEntry.bytes,baseEntry.sha256);
        }else if(io.regularWithin(job,'BaseSystem.dmg').bytes!==baseEntry.bytes || io.sha256(basePath)!==baseEntry.sha256)throw new Error('Stock BaseSystem image differs.');
        io.ensureFree(job,scratchBytes(catalog,direct));
        return source.withMount(io, basePath, job, 'packagebase', false, function (baseRoot, baseMount) {
            var receipts = [];
            catalog.packages.forEach(function (pkg, packageIndex) {
                var completed=0;
                function checked(message){
                    io.progress('components',pkg.name+' ('+(packageIndex+1)+' of '+catalog.packages.length+'): '+message+' — '+completed+' of 8 preparation steps complete.',completed*100/8);
                    completed++;
                }
                checked('Copying and checking the package');
                var componentRoot = io.makeDirectory(job, 'component-' + pkg.name);
                var relative='System/Installation/Packages/'+pkg.name,original;
                if(direct){io.assertReadOnlyImage(frozen.mount);original=frozen.root+'/'+relative;}
                else{io.copyFile(frozen.root+'/'+relative,componentRoot,'Original.pkg');original=componentRoot+'/Original.pkg';}
                if(direct)frozen.verifiedFile(original,pkg.sourceBytes,pkg.sourceSHA256);
                else if(io.regularWithin(componentRoot,'Original.pkg').bytes!==pkg.sourceBytes||io.sha256(original)!==pkg.sourceSHA256)throw new Error('Original component checksum differs: '+pkg.name);
                checked('Extracting and checking package contents');
                var extracted = io.makeDirectory(componentRoot, 'unpacked');
                var expected = {};
                Object.keys(pkg.members).forEach(function (name) { if (name !== 'Scripts') expected[name] = pkg.members[name]; });
                io.extractComponent(original, extracted, Object.keys(expected), job, !!pkg.members.Scripts,direct?frozen.mount:null);
                checkMembers(io, extracted, expected);
                checked('Checking package metadata');
                var template = io.readPackageTemplate(pkg.template, pkg.templateSHA256);
                checked('Preparing package source files');
                // Tahoe PackageKit copies the entire external root, including
                // installer-only files absent from this package's BOM.
                var externalRoot = pkg.externalBaseSystem ? io.prepareExternalRoot(baseMount, extracted + '/Bom', job, pkg.members.Bom.sha256) : null;
                checked('Preparing installation metadata');
                var text = metadata(template, pkg, externalRoot || baseRoot, catalog.externalRootToken);
                io.replacePackageInfo(extracted, text, pkg.members.PackageInfo.sha256, job);
                expected.PackageInfo = {sha256: io.sha256(extracted + '/PackageInfo'), bytes: io.regularWithin(extracted, 'PackageInfo').bytes};
                checked('Repacking the package');
                var prepared = io.packComponent(extracted, componentRoot, 'Prepared.pkg', Object.keys(expected), job);
                if(direct)io.releaseUnpackedPayload(extracted,job);
                checked('Verifying the repacked package');
                var readback = io.makeDirectory(componentRoot, 'readback');
                io.extractComponent(prepared, readback, Object.keys(expected), job, false);
                checkMembers(io, readback, expected);
                if (io.readText(readback + '/PackageInfo') !== text) throw new Error('Repacked component metadata differs.');
                checked('Checking the installation source');
                io.assertReadOnlyImage(baseMount);
                var descriptor = {name: pkg.name, identifier: pkg.identifier, version: pkg.version,
                    path: prepared, sha256: io.sha256(prepared), members: expected, baseSystemMount: baseMount,
                    externalRoot: externalRoot, delivery: pkg.name === 'OSInstall.pkg' ? 'offline-setup' : 'package-payload'};
                checked('Package preparation complete');
                // Installation and receipt verification happen here, before detaching
                // the required external source or preparing the next component.
                consume(descriptor);
                receipts.push({name: pkg.name, identifier: pkg.identifier, version: pkg.version, preparedSHA256: descriptor.sha256,
                    delivery: descriptor.delivery, receiptExpected: descriptor.delivery === 'package-payload'});
                io.removeComponentWorkspace(componentRoot, job);
            });
            return receipts;
        });
    }
    return {scratchBytes:scratchBytes,catalogCheck: catalogCheck, metadata: metadata, withComponents: withComponents};
}());
if (typeof module !== 'undefined') module.exports = MavericksPackagePreparation;
