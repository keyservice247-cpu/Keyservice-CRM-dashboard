// Test: media-reparatie van de WhatsApp-bridge (28 sep 2026, "het CRM stuurt geen
// foto's meer mee"). Sinds de WhatsApp-Web-versies van 17 sep faalt in whatsapp-web.js
// 1.34.7 elke verzending met een bijlage; de bridge zet bij de start zelf de upstream-
// reparatie (`delete message.__x_id`) in de bibliotheek. Draait ZONDER server en zonder
// whatsapp-web.js: de broncode-vorm hieronder is letterlijk het relevante stuk van
// sendMessage uit 1.34.7 (src/util/Injected/Utils.js).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { patchBron, pasMediaFixToe, MEDIAFIX_MARKER } from '../whatsapp-bridge/mediafix.js';

let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }

// Letterlijk de opbouw van het bericht in window.WWebJS.sendMessage (1.34.7), ingekort
// tot wat hier telt: media-opties worden in het bericht uitgespreid.
const BRON = `'use strict';

exports.LoadUtils = () => {
    window.WWebJS = {};
    window.WWebJS.sendMessage = async (chat, content, options = {}) => {
        let mediaOptions = {};
        if (options.media) {
            mediaOptions = await window.WWebJS.processMediaData(options.media, {});
            mediaOptions.caption = options.caption;
            content = mediaOptions.preview;
            delete options.media;
        }
        const quotedMsgOptions = {};
        const botOptions = {};
        const newMsgKey = new (window.require('WAWebMsgKey'))({ id: 'NIEUW-ID' });
        const extraOptions = options.extraOptions || {};
        delete options.extraOptions;

        const message = {
            ...options,
            id: newMsgKey,
            ack: 0,
            body: content,
            type: 'chat',
            ...mediaOptions,
            ...(mediaOptions.toJSON ? mediaOptions.toJSON() : {}),
            ...quotedMsgOptions,
            ...botOptions,
            ...extraOptions,
        };

        // Bot's won't reply if canonicalUrl is set (linking)
        if (botOptions) {
            delete message.canonicalUrl;
        }

        const [msgPromise] = window
            .require('WAWebSendMsgChatAction')
            .addAndSendMsgToChat(chat, message);
        await msgPromise;
        return message;
    };
};
`;

console.log('\n== Reparatie in de broncode zetten ==');
const r1 = patchBron(BRON);
ok('eerste keer: toegepast via het vaste anker', r1.status === 'toegepast' && r1.detail === 'anker', JSON.stringify({ status: r1.status, detail: r1.detail }));
ok('precies één reparatieregel', (r1.src.match(/delete message\.__x_id/g) || []).length === 1);
const iObj = r1.src.indexOf('...extraOptions,\n        };');
const iFix = r1.src.indexOf('delete message.__x_id');
const iAnker = r1.src.indexOf("// Bot's won't reply");
ok('reparatie staat ná het berichtobject en vóór de ankerregel', iObj > 0 && iFix > iObj && iFix < iAnker, `${iObj} < ${iFix} < ${iAnker}`);
ok('inspringing klopt (8 spaties, zoals de ankerregel)', /\n {8}delete message\.__x_id;/.test(r1.src));
ok('gerepareerde broncode is geldige JavaScript', (() => { try { new vm.Script(r1.src); return true; } catch { return false; } })());
const r2 = patchBron(r1.src);
ok('tweede keer: "al-aanwezig", niets dubbel', r2.status === 'al-aanwezig' && r2.src === r1.src);
const zelfOpgelost = BRON.replace("        // Bot's won't reply", '        delete message.__x_id;\n        // Bot\'s won\'t reply');
ok('nieuwere bibliotheek die het zelf oplost: niets aanraken', patchBron(zelfOpgelost).status === 'al-aanwezig');

console.log('\n== Reserve-anker: commentaarregel verdwenen in een andere versie ==');
const zonderAnker = BRON.replace("        // Bot's won't reply if canonicalUrl is set (linking)\n", '');
const r3 = patchBron(zonderAnker);
ok('reserve-anker gevonden (einde van het berichtobject)', r3.status === 'toegepast' && r3.detail === 'reserve-anker', JSON.stringify({ status: r3.status, detail: r3.detail }));
ok('reserve: reparatie direct ná "};" van het bericht', /\.\.\.extraOptions,\n {8}\};\n {8}delete message\.__x_id;/.test(r3.src || ''));
ok('reserve: nog steeds geldige JavaScript', (() => { try { new vm.Script(r3.src); return true; } catch { return false; } })());
ok('onbekende vorm: netjes "anker-niet-gevonden" (bridge start gewoon)', patchBron('exports.LoadUtils = () => {};').status === 'anker-niet-gevonden');
ok('leeg bestand: "fout", geen crash', patchBron('').status === 'fout');

console.log('\n== Gedrag: media-model met eigen __x_id (WhatsApp Web sinds 17 sep) ==');
// Voer sendMessage echt uit met een nagebootste WhatsApp Web-omgeving. Het media-model
// draagt (zoals sinds 17 sep) een opsombare __x_id; zonder reparatie belandt die in het
// bericht en overschrijft hij daar de échte id ("Data passed to getter must include an id").
async function verstuurMetMedia(src) {
  const ctx = { exports: {} };
  let gevangen = null;
  class MsgKey { constructor(o) { Object.assign(this, o); } }
  class MediaData { constructor() { this.__x_id = 'media-model-id'; this.preview = 'VOORBEELD'; } toJSON() { return { type: 'image', mimetype: 'image/jpeg' }; } }
  ctx.window = {
    require: (m) => ({
      WAWebMsgKey: MsgKey,
      WAWebSendMsgChatAction: { addAndSendMsgToChat: (chat, message) => { gevangen = message; return [Promise.resolve()]; } },
    })[m],
  };
  vm.runInNewContext(src, ctx);
  ctx.exports.LoadUtils();
  ctx.window.WWebJS.processMediaData = async () => new MediaData();
  await ctx.window.WWebJS.sendMessage({ id: 'groep@g.us' }, undefined, { media: { mimetype: 'image/jpeg', data: 'x' } });
  return gevangen;
}
const zonder = await verstuurMetMedia(BRON);
ok('ZONDER reparatie: __x_id van het media-model zit in het bericht (de oorzaak)', zonder && zonder.__x_id === 'media-model-id');
const met = await verstuurMetMedia(r1.src);
ok('MET reparatie: geen __x_id meer in het bericht', met && !('__x_id' in met));
ok('MET reparatie: échte bericht-id + foto-gegevens blijven heel', met && met.id && met.id.id === 'NIEUW-ID' && met.type === 'image' && met.mimetype === 'image/jpeg' && met.body === 'VOORBEELD', JSON.stringify(met));

console.log('\n== Bestand repareren (zoals de bridge bij de start doet) ==');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mediafix-'));
const f = path.join(tmp, 'Utils.js');
fs.writeFileSync(f, BRON);
const b1 = pasMediaFixToe({ bestand: f });
ok('bestand: toegepast', b1.status === 'toegepast', JSON.stringify(b1));
ok('bestand bevat daarna de markering', fs.readFileSync(f, 'utf8').includes(MEDIAFIX_MARKER));
const b2 = pasMediaFixToe({ bestand: f });
ok('bestand: tweede start "al-aanwezig" (idempotent)', b2.status === 'al-aanwezig');
ok('ontbrekend bestand: "fout", geen crash', pasMediaFixToe({ bestand: path.join(tmp, 'bestaat-niet.js') }).status === 'fout');
const zonderLib = pasMediaFixToe();
ok('zonder geïnstalleerde bibliotheek: "niet-gevonden", geen crash', ['niet-gevonden', 'toegepast', 'al-aanwezig'].includes(zonderLib.status), JSON.stringify(zonderLib));
fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n== Bridge laadt de bibliotheek pas NA de reparatie ==');
const bridgeSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'whatsapp-bridge', 'bridge.js'), 'utf8');
ok('geen statische import van whatsapp-web.js (die zou vóór de reparatie laden)', !/^\s*import\s+\w+\s+from\s+['"]whatsapp-web\.js['"]/m.test(bridgeSrc));
const iToe = bridgeSrc.indexOf('pasMediaFixToe()');
const iImp = bridgeSrc.indexOf("await import('whatsapp-web.js')");
ok('eerst pasMediaFixToe(), dán await import(...)', iToe > 0 && iImp > iToe, `${iToe} / ${iImp}`);
ok('groepsberichten zonder link-voorbeeld (fotolink kan de tekst dan niet breken)', /linkPreview:\s*false/.test(bridgeSrc));
ok('bridge meldt het media-resultaat terug aan het CRM', /media\s*\?\s*\{\s*media\s*\}/.test(bridgeSrc));
ok('heartbeat draagt de status van de reparatie', /mediaFix:\s*MEDIA_FIX\.status/.test(bridgeSrc));
ok('bridge-versie is 10 of hoger (CRM zet pas dan de fotolink in het bericht)', Number((bridgeSrc.match(/const BRIDGE_VERSION = (\d+)/) || [])[1]) >= 10);

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
