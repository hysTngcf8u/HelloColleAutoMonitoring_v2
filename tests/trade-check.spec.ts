import { test, devices } from '@playwright/test';
import * as fs from 'fs';
import axios from 'axios';
import 'dotenv/config';

// --- CSV変換スクリプトの期待に合わせた型定義 ---
interface TradeRecord {
    tradeId: string;
    status: string;
    appliedAt: string;
    partnerId: string; // ここに名前を入れる
    mainCard: {
        member: string;
        stars: string;
        series: string;
        partnerPossession: string;
    };
    candidates: { // CSVの候補1〜3に対応
        member: string;
        stars: string;
        series: string;
        possession: string;
    }[];
}

const STATE_FILE = 'trade_status.json';

async function sendNotifications(message: string) {
    if (process.env.DISCORD_WEBHOOK_URL) {
        await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: message }).catch(() => {});
    }
    if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
        await axios.post('https://api.line.me/v2/bot/message/push', {
            to: process.env.LINE_USER_ID,
            messages: [{ type: 'text', text: message }]
        }, { headers: { 'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` } }).catch(() => {});
    }
}

// テスト全体の制限時間を10分に設定
test.setTimeout(600000);

test.use({ ...devices['Pixel 5'], locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });

test('ハロコレ・トレード状況監視', async ({ page }) => {
    let capturedTrades: any[] | null = null;

    // 通信監視（網を張る）
    page.on('response', async (res) => {
        const url = res.url();
        if (url.includes('/trades') && url.includes('type=sender')) {
            try {
                const json = await res.json();
                capturedTrades = json.data || json;
                console.log(`[通信成功] トレードデータ ${capturedTrades?.length}件を捕捉`);
            } catch (e) {}
        }
            // 所持カードAPI（member_cardsなどのURLが含まれるものを想定）
    if (url.includes('/member_cards') || url.includes('/mypage')) {
        try {
            const json = await res.json();
            fs.writeFileSync('my_collection.json', JSON.stringify(json.data || json, null, 2));
            console.log('[通信成功] 所持カードデータを捕捉');
        } catch (e) {}
    }
    });

    // 1. ログイン処理
    console.log('[Step 1] ログインを開始します...');
    await page.goto('https://helloproject.orical.jp/login');

const userId = process.env.MY_USER_ID || '';
const userPw = process.env.MY_PASSWORD || '';

    // 入力
    await page.getByRole('spinbutton').fill(userId);
    await page.getByRole('textbox').fill(userPw);
    
    // サイト側のJSに入力を認識させるための「タメ」
    await page.waitForTimeout(1000);

    console.log('ログインボタンを強制的にクリックします...');
    const loginBtn = page.getByRole('button', { name: 'ログイン' });

    // ボタンの状態に関わらず、属性を書き換えて強引にクリック
    await loginBtn.evaluate((el) => {
        el.removeAttribute('disabled');
        (el as HTMLElement).click();
    });

    // Enterキーも念のため送る
    await page.keyboard.press('Enter');

    // 2. URLの遷移を待つ（失敗しても次に進むようにcatchを入れる）
    console.log('ホーム画面への遷移を待機中...');
    await page.waitForURL(/\/home/, { timeout: 15000 }).catch(() => {
        console.log('URL遷移の待機がタイムアウトしました。現在のURL:', page.url());
    });

    // --- 追加：所持カードデータのキャプチャ設定 ---
    let capturedCollection: any = null;
    page.on('response', async (res) => {
        const url = res.url();
        // 自分の所持カード一覧を取得しているAPIを捕捉
        if (url.includes('/member_cards')) { 
            try {
                capturedCollection = await res.json();
            } catch (e) {}
        }
    });

    // 自分のコレクションページへ移動
    console.log('[Step 2.5] 所持カード情報を取得するためコレクションへ移動...');
    await page.goto('https://helloproject.orical.jp/mypage/beyomiyo_reirei');
    
    // データが飛んでくるまで少し待機（画面を少しスクロールして読み込みを促す）
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(2000);

    if (capturedCollection) {
        fs.writeFileSync('my_collection.json', JSON.stringify(capturedCollection.data || capturedCollection, null, 2));
        console.log('✅ 所持カードデータを my_collection.json に保存しました。');
    }
    // --- ここまで ---

    // その後、元の「トレード一覧」を取得するためにホームへ戻るか、直接トレードURLへ飛ぶ
    await page.goto('https://helloproject.orical.jp/home');

    // 3. 通信が来るのを待つ（ここがメインの待機）
    for (let i = 0; i < 20; i++) {
        if (capturedTrades) break;
        // もし全然来ないなら、画面を少しスクロールしてAPI発火を促す
        if (i === 10) {
            console.log('通信が来ないため、スクロールして刺激を与えます...');
            await page.evaluate(() => window.scrollBy(0, 500));
        }
        await page.waitForTimeout(1000);
    }

      if (!capturedTrades) /* {
        console.log('× トレードデータが取得できませんでした。');
        await page.screenshot({ path: 'login_error.png' });  */
        return;
    

// 4. データ解析（デバッグ情報に基づき、description と person.name を優先）
    console.log('[Step 3] 確定したパスからメンバー名と候補情報を抽出中...');
    const currentResults: TradeRecord[] = capturedTrades.map((t) => {
        const statusMap: Record<string, string> = {
            pending: '申請中', accepted: '成立', rejected: '不成立', cancelled: 'キャンセル'
        };

        const receiver = t.receiver_partner_user || {};
        const rcUser = t.request_card_user || {};
        const card = rcUser.card || {};
        
        // --- 1. メインカードの名前を救出 ---
        // デバッグ情報より、人名は description または person.name に入っていることが確定
        const member = card.description || card.person?.name || "不明";
        const series = card.name || "-"; // card.name がシリーズ名（SPRING TOUR等）

        // --- 2. 候補（tradeoffers）の解析 ---
        const offers = t.tradeoffers || [];
        const candidateList = offers.map((off: any) => {
            const ocu = off.offer_card_user || {};
            const oCard = ocu.card || {};
            
            // 星の数（rarity）
            const rVal = oCard.rarity || 1;
            const starText = '★'.repeat(Number(rVal));

            // 候補側の名前とシリーズ
            const cMember = oCard.description || oCard.person?.name || "不明";
            const cSeries = oCard.name || "-";

            return {
                member: cMember,
                stars: starText,
                series: cSeries,
                possession: ocu.amount !== undefined ? String(ocu.amount) : "-" // 自分所持
            };
        });

        // 相手所持の数値
        const partnerPoss = rcUser.amount !== undefined ? String(rcUser.amount) : "-";

        return {
            tradeId: String(t.id),
            status: statusMap[t.status] || t.status,
            appliedAt: t.created_at || '',
            partnerId: receiver.screen_name || '不明', 
            mainCard: {
                member: member,
                stars: '★'.repeat(Number(card.rarity || 1)),
                series: series,
                partnerPossession: partnerPoss
            },
            candidates: candidateList
        };
    });

    // 5. 状態比較と通知（VSCodeの警告箇所も修正済み）
    const savedState = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) : { trades: {} };
    const messages: string[] = [];

// --- 修正後 ---
for (const trade of currentResults) {
    console.log(`[${trade.status}] ${trade.mainCard.member} ${trade.mainCard.stars} (相手: ${trade.partnerId})`);

    const prevState = savedState.trades[trade.tradeId];
    if (prevState && prevState.status === '申請中' && trade.status !== '申請中' && trade.status !== 'キャンセル') {
        const icon = trade.status === '成立' ? '✅' : '❌';
        
        // ここに「シリーズ: ...」を追加しました
        messages.push(
            `${icon} トレード【${trade.status}】\n` +
            `カード: ${trade.mainCard.member} ${trade.mainCard.stars}\n` +
            `シリーズ: ${trade.mainCard.series}\n` + // ←これを追加
            `相手: ${trade.partnerId}`
        );
    }
    savedState.trades[trade.tradeId] = trade;
}

    fs.writeFileSync(STATE_FILE, JSON.stringify(savedState, null, 2));
    console.log(`[完了] ${currentResults.length}件のデータを保存しました。CSV変換を実行してください。`);

// GAS送信後、レスポンスを受け取る
    const res = await axios.post(GAS_URL, { type: 'trade', data: tradeData });
    
    // GAS側で「変化あり（shouldNotify: true）」と判定され、かつレポートがある場合
    if (res.data.shouldNotify && res.data.report) {
        const message = res.data.report;

        // Discord通知
        if (process.env.DISCORD_WEBHOOK_URL) {
            await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: message });
        }

        // LINE通知
        if (process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_USER_ID) {
            await axios.post('https://api.line.me/v2/bot/message/push', {
                to: process.env.LINE_USER_ID,
                messages: [{ type: 'text', text: message }]
            }, {
                headers: { 'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
            }).catch(e => console.error("LINE送信失敗"));
        }
    }
});