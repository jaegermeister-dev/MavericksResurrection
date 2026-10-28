/* The selected installation model is separate from the detected host identity. */
var MavericksResurrectionInstallModel = (function () {
    'use strict';
    var policy = typeof MavericksPolicy !== 'undefined' ? MavericksPolicy : require('./Policy.js');
    var patches = typeof MavericksPatchPlan !== 'undefined' ? MavericksPatchPlan : require('./PatchPlan.js');
    var boards = {'MacBookPro11,4':'Mac-06F11FD93F0323C5','MacBookPro11,5':'Mac-06F11F11946D27C5'};
    var families = ['MacBookPro','MacBookAir','MacBook','MacPro','Macmini','iMacPro','iMac','Xserve'];
    function normalize(text) {
        var match = typeof text === 'string' && text.trim().match(/^([A-Za-z]+)([1-9][0-9]{0,3}),([0-9]{1,4})$/);
        if (!match) throw new Error('Enter a full Mac model identifier, for example MacBookPro11,5.');
        var family = families.filter(function (s) { return s.toLowerCase() === match[1].toLowerCase(); })[0];
        if (!family) throw new Error('Enter a Mac model identifier, for example MacBookPro11,5.');
        return family + Number(match[2]) + ',' + Number(match[3]);
    }
    function select(host, text, compatibility) {
        if (!host || typeof host.model !== 'string' || typeof host.board !== 'string') throw new Error('The detected Mac identity is missing.');
        var model = normalize(text), overridden = model !== host.model;
        // For an override this describes the selected target, never the detected
        // board. A stock target must not inherit the host's compatibility status.
        var board = overridden ? (boards[model] || '') : host.board;
        return {model:model, board:board, overridden:overridden,
            profile:patches.plan(model,board,'direct').profile,
            compatibilityProfile:policy.profile(model,board,compatibility)};
    }
    function validate(host, choice, compatibility) {
        if (!choice) throw new Error('Confirm the installation model before continuing.');
        var expected = select(host,choice.model,compatibility);
        ['model','board','overridden','profile','compatibilityProfile'].forEach(function (key) {
            if (choice[key] !== expected[key]) throw new Error('The selected installation model changed or is invalid.');
        });
        return expected;
    }
    function confirmed(host, choice, approvals, compatibility) {
        var selected = validate(host,choice,compatibility);
        if (!policy.hostApproved(selected.model,approvals,selected.board,compatibility)) throw new Error('The selected unsupported model requires both confirmations.');
        return selected;
    }
    return {normalize:normalize,select:select,validate:validate,confirmed:confirmed};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionInstallModel;
