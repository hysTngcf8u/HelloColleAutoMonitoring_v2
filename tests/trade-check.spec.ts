import { test, expect } from '@playwright/test';
import axios from 'axios';

test('ハロコレ監視 V2 (GAS連動版)', async ({ page }) => {
    const GAS_URL = process.env.GAS_WEBAPP_URL;
    const MY_ID = process.env.MY_USER_ID;
    const MY_PASS = process.env.MY_PASSWORD;
    const MY_HCID = process.env.MY_HC_ID;

    let capturedTrades: any[] = [];
    let capturedCollection: any[] = [];

    // 通信傍受の設定
    page.on('response', async (res) => {
        const url = res.url();
        try {
            if (url.includes('/trades') && url.includes('type=sender')) {
                const json = await res.json();
                capturedTrades = json.data || json;
                console.log('✅ トレード履歴APIを捕捉');
            }
            if (url.includes('/member_cards')) {
                const json = await res.json();
                capturedCollection = json.data || json;
                console.log('✅ 所持カードAPIを捕捉');
            }
        } catch (e) {}
    });

    // 1. ログイン処理
    console.log('[Step 1] ログインを開始します...');
    await page.goto('https://helloproject.orical.jp/login');
    
    // 入力フィールドが表示されるまで待機
    await page.waitForSelector('input[type="number"]', { timeout: 10000 });
    
    console.log('IDとパスワードを入力中...');
    await page.locator('input[type="number"]').fill(MY_ID!);
    await page.locator('input[type="password"]').fill(MY_PASS!);

    console.log('ログインボタンを明示的にクリックします...');
    // ログインボタンを「ログイン」というテキストを持つボタンとして特定してクリック
    const loginButton = page.getByRole('button', { name: /ログイン/i }).or(page.locator('button[type="submit"]'));
    await loginButton.click();

    // ログイン後の遷移を待機
    try {
        await page.waitForURL(/\/home/, { timeout: 30000 }); 
        console.log('✅ ホーム画面への遷移に成功しました');
    } catch (e) {
        console.error('❌ ログイン遷移タイムアウト。現在のURL:', page.url());
        // ログインエラーメッセージが表示されていないか確認
        const errorMsg = await page.locator('.error-message, .alert').textContent().catch(() => 'なし');
        console.error('表示されているエラー:', errorMsg);
        throw e; // エラーを投げて終了
    }

    // 2. コレクション取得（URLは環境変数を使用）
    console.log('[Step 2] マイページへ移動してカード情報を取得...');
    await page.goto(`https://helloproject.orical.jp/mypage/${MY_HCID}`);
    await page.waitForTimeout(5000);
    await page.evaluate(() => window.scrollBy(0, 2000));

    // 3. トレード履歴取得（ホームへ戻る）
    console.log('[Step 3] ホームへ移動して履歴を確定...');
    await page.goto('https://helloproject.orical.jp/home');
    await page.waitForTimeout(5000);

    // --- GASへのデータ送信処理 ---
    if (!GAS_URL) {
        console.error('❌ GAS_WEBAPP_URL 未設定');
        return;
    }

    // A. コレクション送信
    if (capturedCollection.length > 0) {
        const collectionData = capturedCollection.map(item => ({
            name: item.card?.description || item.card?.person?.name || "不明",
            stars: '★'.repeat(item.card?.rarity || 1),
            series: item.card?.name || "-",
            amount: item.amount
        }));
        await axios.post(GAS_URL, { type: 'collection', data: collectionData }).catch(() => {});
        console.log('GASへコレクションデータを送信完了');
    }

    // B. トレード履歴送信
    if (capturedTrades.length > 0) {
        const tradeData = capturedTrades.map(t => ({
            appliedAt: t.created_at,
            status: t.status === 'pending' ? '申請中' : (t.status === 'accepted' ? '成立' : '不成立'),
            partnerId: t.receiver_partner_user?.screen_name || '不明',
            mainCard: {
                member: t.request_card_user?.card?.description || "不明",
                stars: '★'.repeat(t.request_card_user?.card?.rarity || 1),
                series: t.request_card_user?.card?.name || "-"
            }
        }));

        const res = await axios.post(GAS_URL, { type: 'trade', data: tradeData });
        
        if (res.data && res.data.shouldNotify && res.data.report) {
            if (process.env.DISCORD_WEBHOOK_URL) {
                await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: res.data.report });
            }
            if (process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_USER_ID) {
                await axios.post('https://api.line.me/v2/bot/message/push', {
                    to: process.env.LINE_USER_ID,
                    messages: [{ type: 'text', text: res.data.report }]
                }, {
                    headers: { 'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
                }).catch(() => {});
            }
        }
    }
    console.log('すべての処理が終了しました。');
});