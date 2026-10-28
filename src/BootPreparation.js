/* Prepare the staged OS's own EFI loader and HFS+ boot records. Never set NVRAM. */
var MavericksResurrectionBootPreparation = (function () {
    'use strict';
    var hash = '72f3225ff8efadc607086b5778a328918a7fffbb763cad682b0bb29ed31a4795';
    var folder = 'System/Library/CoreServices', source = 'usr/standalone/i386/boot.efi';
    function verifyBlessing(info, root, ids) {
        var rows = info && info['Finder Info'];
        if (!Array.isArray(rows) || rows.length < 6 || !ids || ids.folder <= 0 || ids.file <= 0 ||
            rows[0]['Directory ID'] !== ids.folder || rows[5]['Directory ID'] !== ids.folder ||
            rows[1]['Directory ID'] !== ids.file || rows[0].Path !== root + '/' + folder ||
            rows[5].Path !== root + '/' + folder || rows[1].Path !== root + '/' + folder + '/boot.efi') {
            throw new Error('HFS+ boot folder/file records do not identify the Mavericks loader.');
        }
        return {folder: folder, file: folder + '/boot.efi', folderID: ids.folder, fileID: ids.file};
    }
    function prepare(io, profile) {
        if (['stock', 'MacBookPro11,4', 'MacBookPro11,5'].indexOf(profile) < 0) throw new Error('Unknown boot preparation profile.');
        io.assertPrivateStage();
        io.verifySystem();
        io.verifyFile(source, hash, 505400);
        io.installLoader(source, folder + '/boot.efi', hash, 505400);
        io.verifyFile(folder + '/boot.efi', hash, 505400);
        var result = io.bless(folder, folder + '/boot.efi');
        var blessing = verifyBlessing(result.info, result.root, result.ids);
        io.verifyFile(folder + '/boot.efi', hash, 505400);
        io.assertPrivateStage();
        return {kind: 'mavericks-boot-preparation', completed: true, profile: profile,
            bootEFI: {path: folder + '/boot.efi', bytes: 505400, sha256: hash}, blessing: blessing,
            startupDiskChanged: false, bootTested: false};
    }
    return {prepare: prepare, verifyBlessing: verifyBlessing};
}());
if (typeof module !== 'undefined') module.exports = MavericksResurrectionBootPreparation;
