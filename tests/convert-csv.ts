import * as fs from 'fs';
import path from 'path';

const STATE_FILE = path.resolve(process.cwd(), 'trade_status.json');
const CSV_FILE = path.resolve(process.cwd(), 'trade_list.csv'); 

function convert() {
    if (!fs.existsSync(STATE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    const trades = data.trades || {};
    const tradeEntries = Object.values(trades);

    let csvContent = "\uFEFF申請日時,ステータス,相手ID,希望カード,希望星,希望シリーズ,相手所持,候補1,候補1星,候補1シリーズ,自分所持1,候補2,候補2星,候補2シリーズ,自分所持2,候補3,候補3星,候補3シリーズ,自分所持3\n";

    const rows = tradeEntries.map((t: any) => {
        const c = t.candidates || [];
        const candCols = [];
        for (let i = 0; i < 3; i++) {
            const cand = c[i] || {};
            candCols.push(`"${cand.member || ""}"`, `"${cand.stars || ""}"`, `"${cand.series || ""}"`, `"${cand.possession || ""}"`);
        }
        return [
            `"${t.appliedAt || ""}"`,
            `"${t.status || ""}"`,
            `"${t.partnerId || ""}"`,
            `"${t.mainCard?.member || ""}"`,
            `"${t.mainCard?.stars || ""}"`,
            `"${t.mainCard?.series || ""}"`,
            `"${t.mainCard?.partnerPossession || ""}"`,
            ...candCols
        ].join(",");
    });

    csvContent += rows.join("\n");
    fs.writeFileSync(CSV_FILE, csvContent);
}
convert();