/**
 * VCC Daily Web Push Notification Script
 * ส่งแจ้งเตือน PWA Web Push ประจำวัน 3 รายการ:
 * 1. แจ้งเตือนนัดหมายพรุ่งนี้ (notify_appt)
 * 2. แจ้งเตือนสรุปแผนเร่งรัดและเฝ้าระวังวัคซีนคอตีบประจำวัน (notify_dtp)
 * 3. แจ้งเตือนเด็กขาดนัดรับวัคซีน (notify_missed)
 */

const webpush = require('web-push');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const ALERT_TYPE = (process.env.ALERT_TYPE || 'all').toLowerCase();

if (!SUPABASE_URL || !SUPABASE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error('❌ Missing required environment variables (SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY).');
    process.exit(1);
}

webpush.setVapidDetails(
    'mailto:thepha.vcc@gmail.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

async function fetchAll(table, select = '*', extraQuery = '') {
    const all = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
        const sep = extraQuery ? '&' : '';
        const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}${sep}${extraQuery}`;
        const res = await fetch(url, {
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
                Range: `${from}-${from + PAGE - 1}`
            }
        });
        if (!res.ok) throw new Error(`Supabase fetch ${table} error: ${res.status} ${await res.text()}`);
        const rows = await res.json();
        all.push(...rows);
        if (rows.length < PAGE) break;
        from += PAGE;
    }
    return all;
}

async function deleteSubscription(endpoint) {
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
            method: 'DELETE',
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`
            }
        });
    } catch (e) {
        console.warn('Could not delete expired subscription:', e.message);
    }
}

function getBangkokDateISO(offsetDays = 0) {
    const now = new Date();
    const bkk = new Date(now.getTime() + 7 * 3600 * 1000 + offsetDays * 86400 * 1000);
    return bkk.toISOString().slice(0, 10);
}

function formatThaiDateShort(iso) {
    if (!iso) return '-';
    const [y, m, d] = iso.split('-').map(Number);
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    return `${d} ${months[(m || 1) - 1]} ${(y < 2400 ? y + 543 : y)}`;
}

function calcAgeMonths(dobRaw) {
    if (!dobRaw || dobRaw === '-') return -1;
    const d = new Date(dobRaw);
    if (isNaN(d.getTime())) return -1;
    let y = d.getFullYear();
    if (y > 2400) y -= 543;
    const now = new Date();
    let months = (now.getFullYear() - y) * 12 + (now.getMonth() - d.getMonth());
    if (now.getDate() < d.getDate()) months--;
    return months;
}

function hasVal(row, keys) {
    const normMap = {};
    for (const k of Object.keys(row)) {
        normMap[k.toLowerCase().replace(/[-\s_.+]/g, '')] = row[k];
    }
    for (const key of keys) {
        const v = normMap[key.toLowerCase().replace(/[-\s_.+]/g, '')];
        if (v !== undefined && v !== null) {
            const s = String(v).trim();
            if (s !== '' && s !== '-' && s !== '0' && s.toLowerCase() !== 'null') return true;
        }
    }
    return false;
}

function evaluateChild(row) {
    const ageM = calcAgeMonths(row.DOB || row.dob);
    if (ageM < 2) return { dtpMissed: 0, epiMissed: 0 };

    const dtpSchedule = [
        { m: 2, keys: ['DTP+HB+Hib1', 'dtphbhib1', 'dtp-hb1', 'dtp1'] },
        { m: 4, keys: ['DTP+HB+Hib2', 'dtphbhib2', 'dtp-hb2', 'dtp2'] },
        { m: 6, keys: ['DTP+HB+Hib3', 'dtphbhib3', 'dtp-hb3', 'dtp3'] },
        { m: 18, keys: ['DTP4', 'dtp4', 'dtphb4'] },
        { m: 48, keys: ['DTP5', 'dtp5'] }
    ];
    const otherSchedule = [
        { m: 2, keys: ['BCG', 'bcg'] },
        { m: 2, keys: ['HBV1', 'hbv1', 'hb1'] },
        { m: 9, keys: ['MMR1', 'mmr1', 'mmr'] },
        { m: 12, keys: ['LJE1', 'laje1', 'je1'] },
        { m: 18, keys: ['MMR2', 'mmr2'] },
        { m: 30, keys: ['LJE2', 'laje2', 'je2'] }
    ];

    let dtpMissed = 0;
    for (const s of dtpSchedule) {
        if (ageM >= s.m && !hasVal(row, s.keys)) dtpMissed++;
    }
    let epiMissed = dtpMissed;
    for (const s of otherSchedule) {
        if (ageM >= s.m && !hasVal(row, s.keys)) epiMissed++;
    }
    return { dtpMissed, epiMissed };
}

function matchScope(row, sub) {
    const role = String(sub.role || '').toLowerCase();
    const hcode = String(sub.hcode || '').trim().replace(/^0+/, '');
    const isAmpur = role === 'admin_ampur' || role === 'admin' || hcode === '860' || hcode === '11390';
    if (isAmpur) return true;

    const rHcode = String(row.hcode || '').trim().replace(/^0+/, '');
    if (hcode && rHcode !== hcode) return false;

    if ((role.includes('อสม') || role === 'vhv') && sub.village && sub.village !== '-') {
        const uMoo = String(sub.village).replace(/\D/g, '').replace(/^0+/, '');
        const rMoo = String(row.moo || row.village || '').replace(/\D/g, '').replace(/^0+/, '');
        if (uMoo && rMoo && uMoo !== rMoo) return false;
    }
    return true;
}

async function sendPush(sub, payload) {
    const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
    };
    try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        return true;
    } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
            console.log(`🗑️ Removing expired subscription (${err.statusCode}): ${sub.username || sub.endpoint.slice(0, 30)}`);
            await deleteSubscription(sub.endpoint);
        } else {
            console.warn(`⚠️ Push error for ${sub.username || 'user'}:`, err.statusCode || err.message);
        }
        return false;
    }
}

async function main() {
    console.log('🚀 Starting VCC Daily Web Push Notification...');
    const subscriptions = await fetchAll('push_subscriptions');
    if (!subscriptions.length) {
        console.log('ℹ️ No active push subscriptions found. Exiting.');
        return;
    }
    console.log(`📱 Found ${subscriptions.length} active subscription(s).`);

    const tomorrowISO = getBangkokDateISO(1);
    const tomorrowThai = formatThaiDateShort(tomorrowISO);

    const [apptsTomorrow, childrenData] = await Promise.all([
        (ALERT_TYPE === 'all' || ALERT_TYPE === 'appt')
            ? fetchAll('appoint', 'hcode,CID,HN,fullname,moo,appointdate,vaccinecode', `appointdate=eq.${tomorrowISO}`)
            : Promise.resolve([]),
        (ALERT_TYPE === 'all' || ALERT_TYPE === 'dtp' || ALERT_TYPE === 'missed')
            ? fetchAll('data', 'hcode,CID,fullname,DOB,type,moo,BCG,HBV1,DTP+HB+Hib1,DTP+HB+Hib2,DTP+HB+Hib3,MMR1,LJE1,DTP4,MMR2,LJE2,DTP5')
            : Promise.resolve([])
    ]);

    const inAreaChildren = childrenData.filter(r => Number(r.type) === 1 || Number(r.type) === 3);

    let sentCount = 0;
    for (const sub of subscriptions) {
        // 1. แจ้งเตือนนัดหมายพรุ่งนี้
        if ((ALERT_TYPE === 'all' || ALERT_TYPE === 'appt') && sub.notify_appt !== false) {
            const scopedAppts = apptsTomorrow.filter(a => matchScope(a, sub));
            if (scopedAppts.length > 0) {
                const ok = await sendPush(sub, {
                    title: `📅 นัดหมายวัคซีนพรุ่งนี้ (${tomorrowThai})`,
                    body: `มีเด็กนัดรับวัคซีนจำนวน ${scopedAppts.length} คน ในเขตรับผิดชอบของท่าน`,
                    tag: `vcc-appt-${tomorrowISO}`,
                    url: './index.html#appointments'
                });
                if (ok) sentCount++;
            }
        }

        // 2 & 3. ประเมินเด็กในเขตรับผิดชอบ (DTP & ขาดนัด)
        if (ALERT_TYPE === 'all' || ALERT_TYPE === 'dtp' || ALERT_TYPE === 'missed') {
            const scopedChildren = inAreaChildren.filter(c => matchScope(c, sub));
            let dtpMissedCount = 0;
            let totalMissedCount = 0;
            for (const c of scopedChildren) {
                const ev = evaluateChild(c);
                if (ev.dtpMissed > 0) dtpMissedCount++;
                if (ev.epiMissed > 0) totalMissedCount++;
            }

            if ((ALERT_TYPE === 'all' || ALERT_TYPE === 'dtp') && sub.notify_dtp !== false && dtpMissedCount > 0) {
                const ok = await sendPush(sub, {
                    title: '🚨 แผนเร่งรัดเฝ้าระวังวัคซีนคอตีบ (DTP)',
                    body: `พบเด็กค้างฉีดวัคซีน DTP จำนวน ${dtpMissedCount} คน ในเขตรับผิดชอบ กรุณาติดตามเร่งรัด`,
                    tag: `vcc-dtp-${getBangkokDateISO(0)}`,
                    url: './index.html#dtpReport'
                });
                if (ok) sentCount++;
            }

            if ((ALERT_TYPE === 'all' || ALERT_TYPE === 'missed') && sub.notify_missed !== false && totalMissedCount > 0) {
                const ok = await sendPush(sub, {
                    title: '⚠️ แจ้งเตือนเด็กขาดนัดรับวัคซีน',
                    body: `มีเด็กขาดนัด/ค้างรับวัคซีนรวม ${totalMissedCount} คน กดเพื่อดูรายชื่อติดตาม`,
                    tag: `vcc-missed-${getBangkokDateISO(0)}`,
                    url: './index.html#missing'
                });
                if (ok) sentCount++;
            }
        }
    }

    console.log(`✅ Completed! Sent ${sentCount} push notification(s).`);
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
