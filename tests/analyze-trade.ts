import fs from 'fs';
import { parse } from 'csv-parse/sync';
import axios from 'axios';

const ARCHIVE_CSV = 'trade_history.csv';

async function analyze(targetId?: string) {
    if (!fs.existsSync(ARCHIVE_CSV)) return;

    const records = parse(fs.readFileSync(ARCHIVE_CSV, 'utf8'), {
        columns: true,
        skip_empty_lines: true,
        bom: true
    });

    const summary: any = { total: 0, success: 0, failed: 0, expired: 0, pending: 0, canceled: 0 };
    const history: any[] = [];

    // 指定された相手のデータを抽出
    records.forEach((row: any) => {
        if (row['相手ID'] === targetId) {
            const status = row['ステータス'];
            summary.total++;
            if (status === '成立') summary.success++;
            else if (status === '不成立') summary.failed++;
            else if (status === '期限切れ') summary.expired++;
            else if (status === '申請中') summary.pending++;
            else if (status === 'キャンセル') summary.canceled++;
            
            history.push(row);
        }
    });

    if (summary.total === 0) {
        console.log("データが見つかりませんでした。");
        return;
    }

    // 成立率の計算
    const den = summary.success + summary.failed + summary.expired;
    const rate = den === 0 ? 0 : (summary.success / den) * 100;

    // --- レポート作成 ---
    let report = `📊 【${targetId}】統計レポート\n`;
    report += `━━━━━━━━━━━━━━━━━━\n`;
    report += `成立率: ${rate.toFixed(1)}% / 取引回数: ${summary.total}\n`;
    report += `成立:${summary.success} / 期限切:${summary.expired} / 不成立:${summary.failed}\n\n`;
    report += `📜 直近の取引履歴 (最新10件)\n`;

    // 日付順に並び替えて最新10件を取得
    const recentTrades = history
        .sort((a, b) => new Date(b['申請日時']).getTime() - new Date(a['申請日時']).getTime())
        .slice(0, 10);

    recentTrades.forEach(t => {
        report += `------------------\n`;
        report += ` ${t['申請日時'].split('T')[0]} (${t['ステータス']})\n`; // 日付部分のみ抽出
        report += ` ${t['希望カード']} ${t['希望星']}\n`;
        report += ` シリーズ: ${t['希望シリーズ']}\n`;
    });

    console.log(report);

    // Discord通知
    if (process.env.SEND_NOTIFICATION === 'true' && process.env.DISCORD_WEBHOOK_URL) {
        await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: report }).catch(() => {});
    }
}

const inputId = process.argv[2];
analyze(inputId);