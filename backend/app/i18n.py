"""Reply language for the offline engine: which language a message is in, and the reply templates.

The offline engine answers in the language the user wrote in: Chinese (any CJK text), Malay (two or more Malay
words, or one in a very short message) or English (everything else, including casual Malaysian English such as
"can pay landlord or not ah"). A message with no language of its own ("300", "ok") keeps the language of the
conversation.

Templates live in TEXT as {key: {"en": ..., "zh": ..., "ms": ...}} and are filled with t(key, lang, **values).
A missing language falls back to English. Amounts keep one format in every language ("CAD 1,150.00"), and payee
names stay as they are, so the reply always matches the cards under it. The helpers below translate the
structured bits that come from the sandbox (account labels, spending categories, FX providers, dates, action
summaries, warning signs), and leave anything they don't recognise in English.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List

LANGS = ("en", "zh", "ms")

_CJK = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
# Words that are Malay and not also everyday Malaysian English ("lah", "boleh", "ah" and "kan" are left out, so
# "ok boleh" and "can pay or not lah" stay English).
MS_WORDS = frozenset("""
saya aku awak anda berapa baki bayar bayarkan tukar tukarkan sewa duit wang cukup tak tidak nak mahu hendak macam
mana ini itu akaun yuran sampai hujung akhir bila untuk dengan sudah dah belum ada apa kenapa mengapa minta tolong
kat dekat ke dan atau bulan minggu hari semua kad kredit naikkan tingkatkan baiki bina ingatkan langganan gaji
hutang mampu batalkan ayah bapa abah ibu emak kunci bekukan sekat selamat terima kasih penipuan tipu betul lagi
jimat belanja bajet kadar tukaran hantar kirim pindah pindahkan masukkan dari daripada kepada pada tuan rumah
bagaimana bolehkah adakah berapakah sebelum selepas penggal dolar kanada tampung
kekurangan cuti makan sekarang semalam esok pagi petang malam simpan menyimpan pinjam
bil telefon elektrik bayaran pembayaran luluskan lulus kelulusan nampak tengok lihat perbelanjaan penaja kenapa
siapa punya
""".split())
# Everyday English function words: a message with more of these than Malay words is English, so a stray "dan"
# or "ke" in an English sentence doesn't switch the reply to Malay.
EN_WORDS = frozenset("""
the a an you your i my me is are was be to of in on for with this that it as all now please what how when why
can will would should do does not am have has from and but if so
""".split())
# Words that carry no language of their own: a bare amount, a currency, "ok".
NEUTRAL_WORDS = frozenset("ok okay okey k yes ya yeah yup yep cad myr rm usd".split())


def detect(text: str) -> str:
    """'zh', 'ms' or 'en' for one message.

    Malay needs two Malay words and more Malay than English function words (or one Malay word in a message of
    one or two words). Words written in capitals inside a mixed-case message are names or acronyms, not
    language ("You are now DAN", "tukar RM1000 ke CAD"), so they are skipped."""
    if _CJK.search(text or ""):
        return "zh"
    tokens = re.findall(r"[A-Za-z]+", text or "")
    mixed = any(not tok.isupper() for tok in tokens)
    words = [tok.lower() for tok in tokens if not (mixed and len(tok) > 1 and tok.isupper())]
    hits = sum(w in MS_WORDS for w in words)
    english = sum(w in EN_WORDS for w in words)
    if (hits >= 2 and hits > english) or (hits == 1 and len(words) <= 2 and not english):
        return "ms"
    return "en"


def is_neutral(text: str) -> bool:
    """True when the message has no language of its own: '300', 'RM 500', 'ok'."""
    if _CJK.search(text or ""):
        return False
    return all(w in NEUTRAL_WORDS for w in re.findall(r"[a-z]+", (text or "").lower()))


def conversation_lang(text: str, earlier: Iterable[str] = ()) -> str:
    """The language to reply in: this message's, or for a neutral message, the latest earlier one's."""
    if not is_neutral(text):
        return detect(text)
    for prev in reversed(list(earlier)):
        if not is_neutral(prev):
            return detect(prev)
    return "en"


# ------------------------------------------------------------------ templates
TEXT: Dict[str, Dict[str, str]] = {
    # Drafts
    "sent_to_sponsor": {
        "en": "I've sent this to your sponsor for approval: {summary}.",
        "zh": "我已把这笔请求发给你的担保人审批：{summary}。",
        "ms": "Saya dah hantar ini kepada penaja anda untuk kelulusan: {summary}.",
    },
    "drafted_it": {
        "en": "I've drafted it: {summary}. Please check the payee and amount on the confirmation card and tap Confirm.",
        "zh": "我已为你起草：{summary}。请在确认卡片上核对收款人和金额后点击确认。",
        "ms": "Saya dah sediakan draf: {summary}. Sila semak penerima dan jumlah pada kad pengesahan, kemudian tekan "
              "Confirm.",
    },
    "then_sponsor": {
        "en": " After you confirm, your sponsor also needs to approve it.",
        "zh": "你确认后，还需要你的担保人批准。",
        "ms": " Selepas anda sahkan, penaja anda juga perlu meluluskannya.",
    },
    "note": {"en": " Note: {text}", "zh": "注意：{text}", "ms": " Nota: {text}"},
    "drafted_partial": {
        "en": "I've drafted: {drafted}. Tap Confirm on each card you want to go ahead. I couldn't do the rest: {error}",
        "zh": "我已起草：{drafted}。请在每张想执行的卡片上点击确认。其余部分我做不了：{error}",
        "ms": "Saya dah sediakan draf: {drafted}. Tekan Confirm pada setiap kad yang anda mahu teruskan. Selebihnya "
              "saya tak dapat buat: {error}",
    },
    "couldnt": {"en": "I couldn't do that: {error}", "zh": "这个我做不了：{error}",
                "ms": "Saya tak dapat buat itu: {error}"},
    "drafted_n": {
        "en": "I've drafted {n} payments: {list}. Check each card and tap Confirm on each one you want to go ahead.",
        "zh": "我已起草 {n} 笔付款：{list}。请逐一核对卡片，在每笔想执行的付款上点击确认。",
        "ms": "Saya dah sediakan {n} draf bayaran: {list}. Semak setiap kad dan tekan Confirm pada yang anda mahu "
              "teruskan.",
    },
    "multi_sponsor_last": {
        "en": " That last one needs your sponsor's approval too, because together they go over your limits.",
        "zh": "最后一笔还需要担保人批准，因为几笔加起来超过了你的限额。",
        "ms": " Yang terakhir itu perlukan kelulusan penaja juga, kerana jumlahnya melebihi had anda.",
    },
    "multi_sponsor_some": {
        "en": " Some need your sponsor's approval too, because together they go over your limits.",
        "zh": "其中几笔还需要担保人批准，因为加起来超过了你的限额。",
        "ms": " Sebahagiannya perlukan kelulusan penaja juga, kerana jumlahnya melebihi had anda.",
    },
    "rent_was": {
        "en": "Rent was {amount} last month ({payee}, {date})",
        "zh": "上个月房租是 {amount}（{payee}，{date}）",
        "ms": "Sewa bulan lepas ialah {amount} ({payee}, {date})",
    },
    "rent_used": {"en": "{note}, so I used that amount. {msg}", "zh": "{note}，所以我按这个金额起草。{msg}",
                  "ms": "{note}, jadi saya guna jumlah itu. {msg}"},
    "rent_used_multi": {"en": "{note}, so I used that amount for rent. {msg}",
                        "zh": "{note}，所以房租按这个金额起草。{msg}",
                        "ms": "{note}, jadi saya guna jumlah itu untuk sewa. {msg}"},
    "rent_can_pay": {
        "en": "{note}; you have {balance} in {account}, so yes. {msg}",
        "zh": "{note}；你的{account}里有 {balance}，够付。{msg}",
        "ms": "{note}; anda ada {balance} dalam {account}, jadi boleh. {msg}",
    },
    "yes_you_have": {"en": "Yes, you have {balance} in {account}. {msg}", "zh": "够，你的{account}里有 {balance}。{msg}",
                     "ms": "Boleh, anda ada {balance} dalam {account}. {msg}"},
    "can_pay_offer": {
        "en": "{lead}Yes, you can: {account} has {balance}, enough for {amount} to {payee}. Say '{cmd}' and I'll draft "
              "it for you to confirm.",
        "zh": "{lead}可以：{account}里有 {balance}，够付给 {payee} 的 {amount}。说“{cmd}”，我就起草好让你确认。",
        "ms": "{lead}Boleh: {account} ada {balance}, cukup untuk {amount} kepada {payee}. Sebut '{cmd}' dan saya akan "
              "sediakan draf untuk anda sahkan.",
    },
    "topup_sent": {
        "en": " When he approves, he picks the transfer service and it lands in your {account}; ask me 'did dad send "
              "the money?' any time to track it.",
        "zh": "他批准时会选择汇款方式，钱会到你的{account}；随时问我“爸爸的钱到了吗？”就能查进度。",
        "ms": " Bila dia luluskan, dia pilih perkhidmatan pindahan dan wang masuk ke {account} anda; tanya saya "
              "'duit ayah dah masuk?' bila-bila masa untuk semak.",
    },
    # Remittance status (get_remittance_status). The card under the reply shows the timeline.
    "remit_none": {
        "en": "You haven't asked your dad for money recently, so nothing is on its way. Say 'ask my dad for 500 for "
              "textbooks' to send him a request.",
        "zh": "你最近没有向爸爸要钱，所以没有在路上的汇款。说“问爸爸要500加币买课本”就能发请求。",
        "ms": "Anda belum minta duit daripada ayah baru-baru ini, jadi tiada wang dalam perjalanan. Sebut 'minta ayah "
              "500 untuk buku' untuk hantar permintaan.",
    },
    "remit_waiting": {
        "en": "Not yet: your request for {amount} ({reason}) is waiting for your dad to approve in his app, and nothing "
              "has been sent.",
        "zh": "还没有：你申请的 {amount}（{reason}）正在等爸爸在他的 App 里批准，钱还没有汇出。",
        "ms": "Belum: permintaan {amount} ({reason}) anda sedang menunggu ayah luluskan dalam app dia, dan belum ada "
              "wang dihantar.",
    },
    "remit_transit": {
        "en": "Yes, your dad sent it: {receive} is on its way to your {account} via {provider}, arriving {eta}. The "
              "amount and rate are locked.",
        "zh": "爸爸已经汇出：{receive} 正通过{provider}汇往你的{account}，预计{eta}到账。金额和汇率已锁定。",
        "ms": "Ya, ayah dah hantar: {receive} dalam perjalanan ke {account} anda melalui {provider}, dijangka sampai "
              "{eta}. Jumlah dan kadar sudah dikunci.",
    },
    "remit_credited": {
        "en": "Yes, it's arrived: {receive} from your dad landed in your {account} {when}, sent via {provider}.",
        "zh": "已到账：爸爸汇来的 {receive} {when}存入了你的{account}（经{provider}）。",
        "ms": "Ya, dah masuk: {receive} daripada ayah sudah masuk ke {account} anda {when}, melalui {provider}.",
    },
    "remit_rejected": {
        "en": "Your dad declined your request for {amount}{note}, so nothing was sent.",
        "zh": "爸爸拒绝了你 {amount} 的申请{note}，所以没有汇款。",
        "ms": "Ayah anda menolak permintaan {amount}{note}, jadi tiada wang dihantar.",
    },
    "remit_stopped": {
        "en": "Your request for {amount} didn't go through ({why}), so nothing arrived. Ask me again if you still "
              "need it.",
        "zh": "你 {amount} 的申请没有完成（{why}），所以没有到账。如果还需要，可以再让我发一次请求。",
        "ms": "Permintaan {amount} anda tidak berjaya ({why}), jadi tiada wang masuk. Minta saya lagi jika masih perlu.",
    },
    "remit_eta_soon": {"en": "any moment now", "zh": "马上", "ms": "sebentar lagi"},
    "remit_eta_today": {"en": "later today", "zh": "今天稍后", "ms": "hari ini"},
    "remit_eta_date": {"en": "by {date}", "zh": "在 {date} 前", "ms": "menjelang {date}"},
    "remit_when_now": {"en": "just now", "zh": "刚刚", "ms": "sebentar tadi"},
    "remit_when_date": {"en": "on {date}", "zh": "于 {date}", "ms": "pada {date}"},
    "remit_why_expired": {"en": "it expired before your dad answered", "zh": "爸爸回复前已过期",
                          "ms": "ia tamat tempoh sebelum ayah jawab"},
    "remit_why_cancelled": {"en": "you withdrew it", "zh": "你撤回了", "ms": "anda menariknya balik"},
    "remit_why_returned": {"en": "the money went back to your dad", "zh": "钱已退回爸爸",
                           "ms": "wang dipulangkan kepada ayah"},
    "remit_why_other": {"en": "the transfer was stopped", "zh": "汇款被中止", "ms": "pindahan dihentikan"},
    "pending_transit": {"en": "On its way from your dad: {list}", "zh": "爸爸已汇出、正在路上：{list}",
                        "ms": "Dalam perjalanan daripada ayah: {list}"},
    # Balances
    # The balances card lists every account; the reply gives the spending money and the total.
    "balances": {"en": "Your balances: {account} has {main} for day-to-day spending. Total is about {total} across "
                       "all your accounts.",
                 "zh": "你的余额：{account}有 {main} 可用于日常开销。所有账户合计约 {total}。",
                 "ms": "Baki anda: {account} ada {main} untuk belanja harian. Jumlah kira-kira {total} untuk semua "
                       "akaun."},
    # Scam shield
    "scam_none": {
        "en": "I don't see common scam signs in that message. It still makes sense to check it against the "
              "organisation's official website or app before paying anything.",
        "zh": "我没有在这条信息里发现常见的诈骗迹象。付款前，最好还是通过该机构的官方网站或 App 核实一下。",
        "ms": "Saya tak nampak tanda scam yang biasa dalam mesej itu. Namun, semak dulu dengan laman web atau app "
              "rasmi organisasi itu sebelum membayar apa-apa.",
    },
    "scam_likely": {"en": "This looks like a scam", "zh": "这很像诈骗", "ms": "Ini nampak seperti scam"},
    "scam_suspicious": {"en": "This has some warning signs", "zh": "这条信息有一些危险信号",
                        "ms": "Mesej ini ada beberapa tanda amaran"},
    "scam_verdict": {
        "en": "{lead}.{why} Don't pay or share any codes, and contact the organisation through its official website "
              "instead. I won't set up any payment for it.",
        "zh": "{lead}。{why}不要付款，也不要透露任何验证码；请通过官方网站联系该机构。我不会为它设置任何付款。",
        "ms": "{lead}.{why} Jangan bayar atau kongsi sebarang kod, dan hubungi organisasi itu melalui laman web "
              "rasminya. Saya tidak akan sediakan sebarang bayaran untuknya.",
    },
    "scam_why": {"en": " Warning signs: {signals}{quote}.", "zh": "危险信号：{signals}{quote}。",
                 "ms": " Tanda amaran: {signals}{quote}."},
    "scam_paste": {
        "en": "Sure. Paste the whole message here (the text, email or chat), and I'll check it for scam signs.",
        "zh": "好的。请把那条信息完整粘贴过来（短信、邮件或聊天记录都可以），我来帮你看看有没有诈骗迹象。",
        "ms": "Boleh. Tampal keseluruhan mesej itu di sini (SMS, e-mel atau chat), dan saya akan semak tanda-tanda "
              "scam.",
    },
    "job_fee": {
        "en": "Be careful: a job that asks you to pay first (a 'training', 'equipment' or 'registration' fee) is one of "
              "the most common scams aimed at students. Real employers in Canada don't charge you to start work. Don't "
              "pay or share your banking details; check the company through its official website. I won't set up a "
              "payment for it.",
        "zh": "小心：要求你先付钱（“培训费”“设备费”或“注册费”）的工作，是针对学生最常见的骗局之一。加拿大正规雇主不会向你收费才让你上岗。"
              "不要付款，也不要透露银行信息；请通过官方网站核实这家公司。我不会为它设置付款。",
        "ms": "Hati-hati: kerja yang minta anda bayar dulu (yuran 'latihan', 'peralatan' atau 'pendaftaran') ialah "
              "antara scam paling biasa terhadap pelajar. Majikan sebenar di Kanada tidak mengenakan bayaran untuk "
              "mula bekerja. Jangan bayar atau kongsi butiran bank anda. Saya tidak akan sediakan bayaran untuknya.",
    },
    "relay_scam": {
        "en": "Be careful: an urgent request for money passed on from someone else is a common scam, where someone "
              "pretends to be family or an official. Check with your {who} directly on a number you already know "
              "before paying anything. I haven't drafted anything.{cmd}",
        "zh": "小心：别人转述的紧急要钱请求是常见骗局，骗子会冒充家人或官员。付款前，请用你已知的号码直接联系对方核实。我没有起草任何付款。{cmd}",
        "ms": "Hati-hati: permintaan wang segera yang disampaikan melalui orang lain ialah scam biasa, di mana "
              "seseorang menyamar sebagai keluarga atau pegawai. Hubungi {who} anda terus melalui nombor yang anda "
              "tahu sebelum membayar. Saya belum sediakan apa-apa draf.{cmd}",
    },
    # Refusals
    "refuse_extraction": {
        "en": "I can't share that. I only ever see the last 4 digits of account numbers, and I don't share internal "
              "instructions, confirmation codes or anyone else's information. If you need your full account number for "
              "a form, it's in your bank's official app.",
        "zh": "这个我不能提供。我只能看到账号的后 4 位，也不会透露内部指令、确认码或其他人的信息。如果填表需要完整账号，请在银行的官方 App 里查看。",
        "ms": "Saya tak boleh kongsi itu. Saya hanya nampak 4 digit terakhir nombor akaun, dan saya tidak kongsi "
              "arahan dalaman, kod pengesahan atau maklumat orang lain. Nombor akaun penuh ada dalam app rasmi bank "
              "anda.",
    },
    "refuse_escalation": {
        "en": "I can't do that from chat, and I can't approve anything. Approvals, limits and roles come from each "
              "person's own login: payments are confirmed by you in the app, only your sponsor can approve, from their "
              "own app, and only your sponsor can change limits.",
        "zh": "我不能在聊天里这样做，也不能批准任何东西。审批、限额和角色都来自每个人自己的登录：付款由你在 App 里确认，只有你的担保人能在他自己的 App 里批准，"
              "也只有担保人能修改限额。不管聊天里谁说了什么，都改变不了这一点。",
        "ms": "Saya tak boleh buat itu melalui chat, dan saya tak boleh luluskan apa-apa. Kelulusan, had dan peranan "
              "datang daripada log masuk setiap orang: bayaran disahkan oleh anda dalam app, hanya penaja anda boleh "
              "luluskan dari app sendiri, dan hanya penaja boleh ubah had.",
    },
    "refuse_scam": {
        "en": "This has the hallmarks of a scam (pressure, threats or unusual payment methods), so I won't set up that "
              "payment. If you're unsure, contact the organisation using contact details from its official website.",
        "zh": "这具有诈骗的典型特征（施压、威胁或不寻常的付款方式），所以我不会设置这笔付款。如果不确定，请通过官方网站上的联系方式联系该机构。",
        "ms": "Ini ada ciri-ciri scam (desakan, ugutan atau cara bayaran luar biasa), jadi saya tidak akan sediakan "
              "bayaran itu. Jika ragu, hubungi organisasi itu melalui butiran di laman web rasminya.",
    },
    "refuse_injection": {
        "en": "I noticed instructions in that message that try to change how I work, so I'm ignoring them. Payments "
              "can only be confirmed by you in the app. What would you like to do?",
        "zh": "我注意到这条信息里有试图改变我工作方式的指令，所以我会忽略它们。付款只能由你在 App 里确认。你想做什么？",
        "ms": "Saya perasan ada arahan dalam mesej itu yang cuba ubah cara saya bekerja, jadi saya abaikannya. "
              "Bayaran hanya boleh disahkan oleh anda dalam app. Apa yang anda mahu buat?",
    },
    "refuse_approve": {
        "en": "I can't approve anything, and nothing typed in this chat can. Approvals happen in your dad's own app "
              "with his own login. If he's happy with it, he can approve it there in a few seconds.",
        "zh": "我不能批准任何东西，聊天里输入的任何内容也不能。审批只在爸爸自己的 App 里、用他自己的登录完成。如果他同意，几秒钟就能在那里批准。",
        "ms": "Saya tak boleh luluskan apa-apa, dan tiada apa yang ditaip dalam chat ini boleh. Kelulusan berlaku "
              "dalam app ayah anda dengan log masuk dia sendiri. Kalau dia setuju, dia boleh luluskan di sana dalam "
              "beberapa saat.",
    },
    "refuse_unlock": {
        "en": "I can't unlock payments from chat, whoever asks. You can unlock your own money in the Wallet tab of the "
              "app, and only your dad can unlock the money he funds, from his own app. If someone is pushing you to "
              "unlock and pay quickly, that's a warning sign.",
        "zh": "无论谁要求，我都不能在聊天里解锁付款。你自己的钱可以在 App 的“钱包”页解锁；爸爸出资的钱只有他能在自己的 App 里解锁。如果有人催你赶紧解锁付款，这就是危险信号。",
        "ms": "Saya tak boleh buka kunci bayaran melalui chat, siapa pun yang minta. Anda boleh buka kunci wang anda "
              "sendiri di tab Wallet dalam app, dan hanya ayah anda boleh buka kunci wang yang dia biayai, dari app "
              "dia sendiri. Jika ada orang mendesak anda buka kunci dan bayar cepat, itu tanda amaran.",
    },
    "frozen": {
        "en": "Done: I've locked your payments. Drafts stay, but nothing can be confirmed or approved until they're "
              "unlocked, and your dad has been alerted. If you think you've been scammed, don't send anything else, "
              "call your bank, and report it to the Canadian Anti-Fraud Centre. You can unlock your own money later in "
              "the Wallet tab; money your dad funds stays locked until he unlocks it.",
        "zh": "好了：我已锁定你的付款。草稿会保留，但在解锁之前任何付款都不能确认或批准，爸爸也已收到提醒。如果你觉得自己被骗了，不要再转任何钱，"
              "马上联系银行，并向加拿大反欺诈中心（Canadian Anti-Fraud Centre）举报。你之后可以在“钱包”页解锁自己的钱；爸爸出资的钱要等他解锁。",
        "ms": "Siap: saya dah kunci bayaran anda. Draf kekal, tetapi tiada apa boleh disahkan atau diluluskan sehingga "
              "dibuka semula, dan ayah anda telah dimaklumkan. Jika anda rasa ditipu, jangan hantar apa-apa lagi, "
              "hubungi bank anda dan laporkan kepada Canadian Anti-Fraud Centre. Anda boleh buka kunci wang sendiri "
              "kemudian di tab Wallet; wang yang ayah biayai kekal berkunci sehingga dia membukanya.",
    },
    # Confirmation chatter
    "chatter_flagged": {
        "en": "Tap Confirm on the card above; I can't confirm or approve payments for you from chat.",
        "zh": "请在上方卡片上点击确认；我不能在聊天里替你确认或批准付款。",
        "ms": "Tekan Confirm pada kad di atas; saya tak boleh sahkan atau luluskan bayaran untuk anda melalui chat.",
    },
    "chatter_mine": {
        "en": "Tap Confirm on the card above ({what}). I can't confirm payments for you; only your tap in the app does "
              "that.",
        "zh": "请在上方卡片上点击确认（{what}）。我不能替你确认付款，只有你在 App 里亲自点击才算数。",
        "ms": "Tekan Confirm pada kad di atas ({what}). Saya tak boleh sahkan bayaran untuk anda; hanya tekanan anda "
              "dalam app yang boleh.",
    },
    "chatter_n_waiting": {"en": "{n} drafts are waiting", "zh": "有 {n} 份草稿在等你", "ms": "{n} draf sedang menunggu"},
    "chatter_then_dad": {"en": " After you confirm, it goes to your dad to approve.", "zh": "你确认后，它会发给爸爸审批。",
                         "ms": " Selepas anda sahkan, ia akan dihantar kepada ayah anda untuk diluluskan."},
    "chatter_dad": {
        "en": "That's already confirmed and waiting for your dad to approve it in his app ({what}). I can't approve it "
              "for him.",
        "zh": "这笔已经确认了，正在等爸爸在他的 App 里批准（{what}）。我不能替他批准。",
        "ms": "Itu sudah disahkan dan sedang menunggu ayah anda meluluskannya dalam app dia ({what}). Saya tak boleh "
              "luluskan bagi pihaknya.",
    },
    "chatter_none": {
        "en": "There's nothing waiting for you to confirm right now. Tell me what you'd like to pay or convert and I'll "
              "draft it for you to confirm.",
        "zh": "现在没有等你确认的草稿。告诉我你想付什么或换什么，我来起草，由你确认。",
        "ms": "Tiada apa yang menunggu pengesahan anda sekarang. Beritahu saya apa yang anda mahu bayar atau tukar, "
              "dan saya akan sediakan draf untuk anda sahkan.",
    },
    "chatter_offer": {"en": " If you'd also like the next step, say '{offer}'.", "zh": "如果还想做下一步，就说“{offer}”。",
                      "ms": " Jika anda mahu langkah seterusnya, sebut '{offer}'."},
    "okay_else": {"en": "Okay! Anything else I can help with?", "zh": "好的！还有什么可以帮你？",
                  "ms": "Baik! Ada apa-apa lagi yang saya boleh bantu?"},
    "welcome": {"en": "You're welcome.", "zh": "不客气。", "ms": "Sama-sama."},
    # Questions back to the user
    "ask_who_amount": {"en": "Who would you like to pay the {amount} to?", "zh": "这笔 {amount} 你想付给谁？",
                       "ms": "Kepada siapa anda mahu bayar {amount} itu?"},
    "ask_who": {"en": "Who would you like to pay?", "zh": "你想付给谁？", "ms": "Anda mahu bayar kepada siapa?"},
    "ask_who_payees": {"en": "{lead} Your saved payees are {names}.", "zh": "{lead}你保存的收款人有 {names}。",
                       "ms": "{lead} Penerima yang disimpan ialah {names}."},
    "ask_which_each": {
        "en": "I couldn't tell which payee each amount is for. Could you send them one at a time, for example 'pay "
              "hydro 45'?",
        "zh": "我分不清每笔金额对应哪个收款人。可以一笔一笔发给我吗？比如“付水电费45”。",
        "ms": "Saya tak pasti jumlah mana untuk penerima mana. Boleh hantar satu-satu, contohnya 'bayar hydro 45'?",
    },
    "too_many": {
        "en": "That's a lot of payments in one message. Please send them two or three at a time so you can check each "
              "one.",
        "zh": "一条信息里的付款太多了。请每次发两三笔，这样你能逐一核对。",
        "ms": "Itu terlalu banyak bayaran dalam satu mesej. Sila hantar dua atau tiga sekali gus supaya anda boleh "
              "semak setiap satu.",
    },
    "not_a_payee": {
        "en": "{name} isn't one of your saved payees, so I can't pay them from here. To pay someone new, say 'add a "
              "new payee' with their name and account number. Your sponsor approves new payees, and then there's a "
              "short cooling period before the first payment.",
        "zh": "{name} 不在你保存的收款人里，所以我不能从这里付款。要付给新的人，请说“add a new payee”并附上对方姓名和账号。新收款人需要担保人批准，"
              "之后还有一段短暂的冷静期才能首次付款。",
        "ms": "{name} bukan penerima yang disimpan, jadi saya tak boleh bayar dari sini. Untuk bayar orang baharu, "
              "sebut 'add a new payee' dengan nama dan nombor akaun mereka. Penaja anda meluluskan penerima baharu, "
              "dan ada tempoh bertenang yang singkat sebelum bayaran pertama.",
    },
    "ask_how_much_to": {"en": "How much would you like to send to {payee}?{hint}", "zh": "你想给 {payee} 转多少钱？{hint}",
                        "ms": "Berapa yang anda mahu hantar kepada {payee}?{hint}"},
    "rent_hint": {
        "en": " If it's this month's rent, say 'pay rent' and I'll use last month's amount.",
        "zh": "如果是这个月的房租，说“交房租”，我会按上个月的金额。",
        "ms": " Jika ini sewa bulan ini, sebut 'bayar sewa' dan saya akan guna jumlah bulan lepas.",
    },
    "ask_how_much_each": {
        "en": "How much is the {payee} payment? Please send that one with its amount, e.g. 'pay {key} 45'.",
        "zh": "给 {payee} 的那笔是多少钱？请连同金额一起发，比如“pay {key} 45”。",
        "ms": "Berapa jumlah bayaran {payee}? Sila hantar dengan jumlahnya, contohnya 'bayar {key} 45'.",
    },
    "from_myr_wallet": {
        "en": "{payee} is paid in CAD, so it can't come straight out of your MYR Wallet. Convert some MYR into CAD "
              "Everyday first (for example 'convert 500 MYR to CAD'), then ask me to pay it from there.",
        "zh": "{payee} 要用加币支付，所以不能直接从马币钱包付。请先把一部分马币换进 CAD 日常账户（比如“把500马币换成加币”），再让我从那里付款。",
        "ms": "{payee} dibayar dalam CAD, jadi tak boleh terus dari MYR Wallet anda. Tukar sedikit MYR ke CAD Everyday "
              "dulu (contohnya 'tukar 500 MYR ke CAD'), kemudian minta saya bayar dari situ.",
    },
    "ask_topup": {"en": "How much would you like to ask for, and what is it for?", "zh": "你想向爸爸要多少钱？用来做什么？",
                  "ms": "Berapa yang anda mahu minta, dan untuk apa?"},
    "ask_topup_reason": {
        "en": "What is it for? Say it in one go, for example 'ask my dad for {amount} for textbooks', and I'll send him "
              "the request.",
        "zh": "用来做什么？请一次说完，比如“问爸爸要{amount}加币买课本”，我就把请求发给他。",
        "ms": "Untuk apa? Sebut sekali gus, contohnya 'minta ayah {amount} untuk buku teks', dan saya akan hantar "
              "permintaan itu kepadanya.",
    },
    "ask_afford": {"en": "How much does it cost? I'll check it against your balance and upcoming bills.",
                   "zh": "它多少钱？我会对照你的余额和即将到期的账单帮你看看。",
                   "ms": "Berapa harganya? Saya akan semak dengan baki dan bil yang akan datang."},
    "ask_when": {"en": "Sure. When should I remind you? For example 'on the 1st', 'next Friday' or 'Oct 30'.",
                 "zh": "好的。什么时候提醒你？比如“1号”“下周五”或“10月30日”。",
                 "ms": "Boleh. Bila saya patut ingatkan anda? Contohnya 'on the 1st', 'next Friday' atau 'Oct 30'."},
    "ask_from_account": {"en": "Which account should the money come from: CAD Everyday or your MYR Wallet?",
                         "zh": "钱从哪个账户出：CAD 日常账户还是马币钱包？",
                         "ms": "Wang itu dari akaun mana: CAD Everyday atau MYR Wallet anda?"},
    "ask_move_amount": {"en": "How much would you like to move?", "zh": "你想转多少钱？",
                        "ms": "Berapa yang anda mahu pindahkan?"},
    "ask_payee_details": {
        "en": "Sure. What's the payee's name, and their account number? For example: add payee Campus Books, business, "
              "CAD, account 1111-2222-3333.",
        "zh": "好的。收款人叫什么名字，账号是多少？例如：add payee Campus Books, business, CAD, account 1111-2222-3333。",
        "ms": "Boleh. Apa nama penerima dan nombor akaunnya? Contohnya: add payee Campus Books, business, CAD, account "
              "1111-2222-3333.",
    },
    "ask_cancel_what": {
        "en": "What would you like me to cancel? I can cancel drafts that haven't gone through yet: say 'cancel that "
              "payment' or 'cancel the conversion'.",
        "zh": "你想取消什么？我可以取消还没执行的草稿：说“取消那笔付款”或“取消兑换”。",
        "ms": "Apa yang anda mahu saya batalkan? Saya boleh batalkan draf yang belum diproses: sebut 'batalkan "
              "bayaran itu' atau 'batalkan pertukaran'.",
    },
    "cancelled": {"en": "Cancelled: {list}.", "zh": "已取消：{list}。", "ms": "Dibatalkan: {list}."},
    "nothing_to_cancel": {"en": "There's nothing pending to cancel.", "zh": "没有待处理的草稿可以取消。",
                          "ms": "Tiada apa yang tertangguh untuk dibatalkan."},
    "reminder_set": {"en": "Done. I'll remind you on {date}: {what}.", "zh": "好了。我会在 {date} 提醒你：{what}。",
                     "ms": "Siap. Saya akan ingatkan anda pada {date}: {what}."},
    "reminder_no_draft": {
        "en": " I haven't drafted any payment; when it's time, say '{what}' and I'll prepare it for you to confirm.",
        "zh": "我没有起草任何付款；到时候说“{what}”，我再起草好让你确认。",
        "ms": " Saya belum sediakan sebarang bayaran; bila tiba masanya, sebut '{what}' dan saya akan sediakannya "
              "untuk anda sahkan.",
    },
    # Amount problems (offline_nlu.amount_issue)
    "amt_negative": {"en": "Amounts can't be negative. How much would you like to send?",
                     "zh": "金额不能是负数。你想转多少钱？", "ms": "Jumlah tidak boleh negatif. Berapa yang anda mahu hantar?"},
    "amt_scientific": {
        "en": "I can't read that amount (it looks like scientific notation). Please type it as a plain number, for "
              "example 85 or 1,200.",
        "zh": "我看不懂这个金额（看起来像科学计数法）。请输入普通数字，比如 85 或 1,200。",
        "ms": "Saya tak dapat baca jumlah itu (nampak seperti tatatanda saintifik). Sila taip nombor biasa, contohnya "
              "85 atau 1,200.",
    },
    "amt_too_small": {"en": "That amount is less than one cent. How much did you mean?",
                      "zh": "这个金额不到一分钱。你想转多少？", "ms": "Jumlah itu kurang daripada satu sen. Berapa maksud anda?"},
    "amt_too_large": {
        "en": "{value} is far more than any payment I can draft here. Please check the amount and type it again.",
        "zh": "{value} 远远超过我在这里能起草的任何付款。请核对金额后重新输入。",
        "ms": "{value} jauh melebihi sebarang bayaran yang boleh saya sediakan di sini. Sila semak jumlah dan taip "
              "semula.",
    },
    # Not enough money
    "shortfall": {
        "en": "{note}{account} has {balance}, so {what} would leave you {short} short and the payment would fail. I "
              "haven't drafted it. ",
        "zh": "{note}{account}里只有 {balance}，所以{what}会差 {short}，付款会失败。我没有起草这笔付款。",
        "ms": "{note}{account} ada {balance}, jadi {what} akan kurang {short} dan bayaran akan gagal. Saya belum "
              "sediakan draf. ",
    },
    "shortfall_one": {"en": "{amount} to {payee}", "zh": "付给 {payee} 的 {amount}", "ms": "{amount} kepada {payee}"},
    "shortfall_many": {"en": "{n} payments totalling {total}", "zh": "这 {n} 笔共 {total} 的付款",
                       "ms": "{n} bayaran berjumlah {total}"},
    "shortfall_convert": {
        "en": "You could convert about MYR {myr} from your MYR Wallet first (say '{convert}'){big}, then ask me "
              "again; or ask your dad for a top-up (say '{ask}').",
        "zh": "你可以先从马币钱包换约 MYR {myr}（说“{convert}”）{big}，然后再问我；或者请爸爸补钱（说“{ask}”）。",
        "ms": "Anda boleh tukar kira-kira MYR {myr} dari MYR Wallet dulu (sebut '{convert}'){big}, kemudian tanya "
              "saya semula; atau minta ayah tambah duit (sebut '{ask}').",
    },
    "shortfall_big": {"en": ", which your dad approves too as it's over CAD 1,500 of sponsor money",
                      "zh": "，超过 CAD 1,500 的担保资金也需要爸爸批准",
                      "ms": ", yang perlu diluluskan ayah juga kerana melebihi CAD 1,500 wang penaja"},
    "shortfall_ask": {"en": "Ask your dad for a top-up: say '{ask}'.", "zh": "请爸爸补钱：说“{ask}”。",
                      "ms": "Minta ayah tambah duit: sebut '{ask}'."},
    "ask_dad_cmd": {"en": "ask my dad for {n} for bills", "zh": "问爸爸要{n}加币交账单",
                    "ms": "minta ayah {n} untuk bil"},
    "convert_cmd": {"en": "convert {n} MYR to CAD", "zh": "把{n}马币换成加币", "ms": "tukar {n} MYR ke CAD"},
    # FX
    "fx_cheapest": {
        "en": "{lead}Cheapest for {amount}{example} is the {best}: {receive} arrives (true cost {pct}%, {speed}). That "
              "saves {saving} compared with the {worst}. {note}Rates are a sandbox snapshot, not advice.",
        "zh": "{lead}{amount}{example}，最便宜的方式是 {best}：到账 {receive}（真实成本 {pct}%，{speed}）。比{worst}多到账 "
              "{saving}。{note}汇率为沙盒快照，仅供参考，不构成建议。",
        "ms": "{lead}Paling murah untuk {amount}{example} ialah {best}: {receive} sampai (kos sebenar {pct}%, {speed}). "
              "Itu jimat {saving} berbanding {worst}. {note}Kadar ialah snapshot sandbox, bukan nasihat.",
    },
    "fx_example": {"en": " (an example amount)", "zh": "（示例金额）", "ms": " (jumlah contoh)"},
    "fx_not_payee": {
        "en": "{who} not one of your saved payees, so I can't send it from HomeBridge; here's the cheapest way to send "
              "it yourself. ",
        "zh": "{who}不在你保存的收款人里，所以我不能从 HomeBridge 汇款；下面是你自己汇款最便宜的方式。",
        "ms": "{who} bukan penerima yang disimpan, jadi saya tak boleh hantar dari HomeBridge; ini cara paling murah "
              "untuk hantar sendiri. ",
    },
    "fx_family": {"en": "Family back home are", "zh": "家里人", "ms": "Keluarga di kampung"},
    "fx_your": {"en": "Your {who} is", "zh": "你的{who}", "ms": "{who} anda"},
    "fx_brands": {
        "en": "I don't have quotes for named brands; the sandbox compares provider types, and a low-cost transfer "
              "service is the Wise-style option. ",
        "zh": "我没有具体品牌的报价；沙盒比较的是服务类型，“低成本汇款服务”就是类似 Wise 的选项。",
        "ms": "Saya tiada sebut harga untuk jenama tertentu; sandbox membandingkan jenis penyedia, dan perkhidmatan "
              "pindahan kos rendah ialah pilihan seperti Wise. ",
    },
    "fx_cached": {"en": "{note} ", "zh": "实时报价暂时不可用，以下是缓存报价，可能略有过时。",
                  "ms": "Sebut harga langsung tidak tersedia; ini sebut harga simpanan dan mungkin sedikit lapuk. "},
    "fx_rate": {
        "en": "Today's mid-market rate (sandbox snapshot): 1 {src} = {mid} {dst}, or 1 {dst} = {inv} {src}. So "
              "{amount} is about {mid_amount} at mid-market; converting in HomeBridge you'd get {inapp} ({pct}% "
              "margin). I can't predict where rates go next.",
        "zh": "今天的中间价（沙盒快照）：1 {src} = {mid} {dst}，即 1 {dst} = {inv} {src}。所以 {amount} 按中间价约合 "
              "{mid_amount}；在 HomeBridge 兑换可得 {inapp}（汇差 {pct}%）。我无法预测汇率走势。",
        "ms": "Kadar tengah pasaran hari ini (snapshot sandbox): 1 {src} = {mid} {dst}, atau 1 {dst} = {inv} {src}. "
              "Jadi {amount} lebih kurang {mid_amount} pada kadar tengah; jika tukar dalam HomeBridge anda dapat "
              "{inapp} (margin {pct}%). Saya tak boleh ramal arah kadar seterusnya.",
    },
    "fx_history": {
        "en": "I can't predict exchange rates. Over the last {days} days {pair} ranged from {low} to {high}, and today "
              "is {today} (average {avg}). If you need the money for a fixed date like tuition, converting in a few "
              "smaller amounts over time reduces the risk of a bad day.",
        "zh": "我无法预测汇率。过去 {days} 天 {pair} 在 {low} 到 {high} 之间波动，今天是 {today}（平均 {avg}）。如果钱要在固定日期用（比如学费），"
              "分几次小额兑换可以降低碰上坏汇率的风险。",
        "ms": "Saya tak boleh ramal kadar tukaran. Dalam {days} hari lepas {pair} antara {low} dan {high}, dan hari "
              "ini {today} (purata {avg}). Jika anda perlukan wang pada tarikh tetap seperti yuran, tukar sedikit "
              "demi sedikit mengurangkan risiko hari yang buruk.",
    },
    "convert_fee": {
        "en": " The fee is {pct}% in the exchange rate (rate {rate} against mid-market {mid}).",
        "zh": "手续费体现在汇率里：{pct}%（汇率 {rate}，中间价 {mid}）。",
        "ms": " Yurannya {pct}% dalam kadar tukaran (kadar {rate} berbanding tengah pasaran {mid}).",
    },
    "convert_too_much": {
        "en": "Your {account} has {balance}, so I can't convert {amount}; it would fail. I haven't drafted it. I can "
              "convert up to {whole}{sponsor}, or you can ask your dad for a top-up.",
        "zh": "你的{account}只有 {balance}，所以不能兑换 {amount}，会失败。我没有起草。我最多可以帮你兑换 {whole}{sponsor}，或者你可以请爸爸补钱。",
        "ms": "{account} anda ada {balance}, jadi saya tak boleh tukar {amount}; ia akan gagal. Saya belum sediakan "
              "draf. Saya boleh tukar sehingga {whole}{sponsor}, atau anda boleh minta ayah tambah duit.",
    },
    "convert_sponsor_cap": {
        "en": " (more than about CAD 1,500 of sponsor money needs your dad's approval too)",
        "zh": "（超过约 CAD 1,500 的担保资金也需要爸爸批准）",
        "ms": " (lebih daripada kira-kira CAD 1,500 wang penaja perlu kelulusan ayah juga)",
    },
    "move_no_fee": {"en": " It's a move between your own accounts, so there's no fee.",
                    "zh": "这是你自己账户之间的转账，没有手续费。",
                    "ms": " Ini pindahan antara akaun anda sendiri, jadi tiada yuran."},
    "move_from_fund": {"en": " Money leaving the Tuition Fund always needs your dad's approval.",
                       "zh": "从学费基金转出的钱总是需要爸爸批准。",
                       "ms": " Wang yang keluar dari Tuition Fund sentiasa perlu kelulusan ayah anda."},
    "move_too_much": {"en": "Your {account} has {balance}, so moving {amount} would fail. I haven't drafted it.",
                      "zh": "你的{account}只有 {balance}，转 {amount} 会失败。我没有起草。",
                      "ms": "{account} anda ada {balance}, jadi memindahkan {amount} akan gagal. Saya belum sediakan "
                            "draf."},
    # Tuition
    "tuition_none": {"en": "You have no unpaid tuition installments.", "zh": "你没有未付的学费分期。",
                     "ms": "Anda tiada ansuran yuran yang belum dibayar."},
    "tuition_next": {
        "en": "Your next tuition installment is {amount} for {term}, due {due} ({days} days away). Your tuition fund "
              "has {fund}.",
        "zh": "你下一期学费是 {amount}（{term}），{due} 到期（还有 {days} 天）。你的学费基金里有 {fund}。",
        "ms": "Ansuran yuran seterusnya ialah {amount} untuk {term}, perlu dibayar {due} ({days} hari lagi). Dana "
              "yuran anda ada {fund}.",
    },
    "tuition_short": {
        "en": " That leaves a shortfall of {short}. Your MYR wallet is worth about {myr}, so converting some of it "
              "would cover it, or you could set aside about {monthly} a month.",
        "zh": "还差 {short}。你的马币钱包约值 {myr}，换一部分就能补上；或者每月存约 {monthly}。",
        "ms": " Masih kurang {short}. MYR Wallet anda bernilai kira-kira {myr}, jadi menukar sebahagiannya boleh "
              "menampungnya, atau anda boleh simpan kira-kira {monthly} sebulan.",
    },
    "tuition_covered": {"en": " That covers it.", "zh": "够付了。", "ms": " Itu mencukupi."},
    "tuition_reminder": {"en": " I've also set a reminder for {date}.", "zh": "我也在 {date} 设了提醒。",
                         "ms": " Saya juga dah tetapkan peringatan pada {date}."},
    "tuition_heads_up": {
        "en": " Heads up: the tuition fund is {short} short, so it would fail today. Say '{offer}' and I'll draft that "
              "conversion, or ask your dad for a top-up.",
        "zh": "提醒：学费基金还差 {short}，今天付会失败。说“{offer}”，我就起草这笔兑换；或者请爸爸补钱。",
        "ms": " Perhatian: dana yuran kurang {short}, jadi ia akan gagal hari ini. Sebut '{offer}' dan saya akan "
              "sediakan draf pertukaran itu, atau minta ayah tambah duit.",
    },
    "cover_lead_myr": {
        "en": "UBC is paid in CAD, so money from your MYR Wallet has to go through your Tuition Fund first. ",
        "zh": "UBC 学费用加币支付，所以马币钱包里的钱要先换进学费基金。",
        "ms": "UBC dibayar dalam CAD, jadi wang dari MYR Wallet perlu melalui Tuition Fund dulu. ",
    },
    "cover_nothing": {"en": "Your tuition fund already covers the next installment, so there's nothing to top up.",
                      "zh": "你的学费基金已经够付下一期了，不需要补。",
                      "ms": "Dana yuran anda sudah cukup untuk ansuran seterusnya, jadi tiada apa perlu ditambah."},
    "cover_drafted": {"en": "I've drafted: {list}.", "zh": "我已起草：{list}。", "ms": "Saya dah sediakan draf: {list}."},
    "then": {"en": "; then ", "zh": "；然后", "ms": "; kemudian "},
    "cover_short": {"en": " That covers the CAD {short} shortfall.", "zh": "这样就补上了 CAD {short} 的缺口。",
                    "ms": " Itu menampung kekurangan CAD {short}."},
    "cover_no_conversion": {"en": " Your Tuition Fund already covers it, so no conversion is needed.",
                            "zh": "你的学费基金已经够了，不需要兑换。",
                            "ms": " Tuition Fund anda sudah cukup, jadi tiada pertukaran diperlukan."},
    "cover_in_order": {
        "en": " Confirm them in that order in the app. The tuition payment then goes to your dad for approval.",
        "zh": "请在 App 里按这个顺序确认。学费付款随后会发给爸爸审批。",
        "ms": " Sahkan mengikut urutan itu dalam app. Bayaran yuran kemudian dihantar kepada ayah untuk kelulusan.",
    },
    "cover_then_pay": {"en": " Confirm it in the app, then ask me to pay your tuition.",
                       "zh": "请在 App 里确认，然后让我帮你交学费。",
                       "ms": " Sahkan dalam app, kemudian minta saya bayar yuran anda."},
    "cover_then_tuition_card": {
        "en": " Confirm it first, then confirm the tuition payment card that's already waiting.",
        "zh": "请先确认这笔兑换，再确认已在等待的学费付款卡片。",
        "ms": " Sahkan ini dahulu, kemudian sahkan kad bayaran yuran yang sedang menunggu.",
    },
    # Changing a draft, and money semantics (currency, direction, "all")
    "amend_nothing": {
        "en": "There's no payment or conversion waiting for you to confirm, so there's nothing to change. Tell me what "
              "to draft instead.",
        "zh": "目前没有等你确认的付款或兑换，所以没有可以修改的草稿。告诉我要重新起草什么。",
        "ms": "Tiada bayaran atau pertukaran yang menunggu pengesahan anda, jadi tiada apa untuk diubah. Beritahu "
              "saya apa yang perlu didraf.",
    },
    "amend_done": {"en": "I cancelled the earlier draft ({old}). ", "zh": "我已取消之前的草稿（{old}）。",
                   "ms": "Saya dah batalkan draf sebelum ini ({old}). "},
    "no_usd_wallet": {
        "en": "HomeBridge only has CAD and MYR wallets, so there's no USD to convert from or into. I can convert "
              "between MYR and CAD, or show what USD {amount} is worth (say 'how much is {amount} USD in CAD').",
        "zh": "HomeBridge 只有加币和马币钱包，没有美元可以兑换。我可以帮你在马币和加币之间兑换，或者告诉你 USD {amount} 值多少加币。",
        "ms": "HomeBridge hanya ada dompet CAD dan MYR, jadi tiada USD untuk ditukar. Saya boleh tukar antara MYR "
              "dan CAD, atau tunjukkan nilai USD {amount}.",
    },
    "pay_in_cad": {
        "en": "{payee} is paid in CAD, so I can't send it in {cur}.{extra} Did you mean CAD {amount}? Say '{cmd}' and "
              "I'll draft it in CAD.",
        "zh": "{payee} 只收加币，不能用 {cur} 付。{extra}你是说 CAD {amount} 吗？说“{cmd}”，我就按加币起草。",
        "ms": "{payee} dibayar dalam CAD, jadi saya tak boleh hantar dalam {cur}.{extra} Maksud anda CAD {amount}? "
              "Sebut '{cmd}' dan saya akan sediakan draf dalam CAD.",
    },
    "no_usd_note": {"en": " You only have CAD and MYR wallets.", "zh": "你只有加币和马币钱包。",
                    "ms": " Anda hanya ada dompet CAD dan MYR."},
    "convert_nothing": {"en": "Your {account} is empty, so there's nothing to convert.",
                        "zh": "你的{account}是空的，没有可以兑换的钱。",
                        "ms": "{account} anda kosong, jadi tiada apa untuk ditukar."},
    "ask_convert_amount": {"en": "How much {src} would you like to convert to {dst}?",
                           "zh": "你想把多少 {src} 兑换成 {dst}？",
                           "ms": "Berapa banyak {src} yang anda mahu tukar ke {dst}?"},
    "convert_all_sponsor": {
        "en": " That's everything in your {account}, which your dad funds, so he approves it too.",
        "zh": "这是你{account}里的全部余额，这笔钱是爸爸出资的，所以也需要他批准。",
        "ms": " Itu semua dalam {account} anda, yang ayah anda biayai, jadi dia perlu luluskannya juga.",
    },
    # Spending
    "spent_total": {"en": "In the last 30 days you spent {total}. Biggest categories: {top}.",
                    "zh": "过去 30 天你一共花了 {total}。最大的几项：{top}。",
                    "ms": "Dalam 30 hari lepas anda belanja {total}. Kategori terbesar: {top}."},
    "spent_over": {"en": " Over budget: {list}.", "zh": "超出预算：{list}。", "ms": " Melebihi bajet: {list}."},
    "spent_dupe": {"en": " Possible duplicate charge from {list}; worth checking.", "zh": "{list} 可能重复扣款了，值得核对一下。",
                   "ms": " Mungkin caj berganda daripada {list}; patut disemak."},
    "spent_set_budget": {"en": " To set one, say for example 'set a dining budget of 150'.",
                         "zh": "要设定预算，可以说“set a dining budget of 150”。",
                         "ms": " Untuk tetapkan, sebut contohnya 'set a dining budget of 150'."},
    "spent_focus": {"en": "In the last 30 days: {parts}.", "zh": "过去 30 天：{parts}。", "ms": "Dalam 30 hari lepas: {parts}."},
    "spent_against": {"en": " against a budget of {budget}", "zh": "（预算 {budget}）", "ms": " berbanding bajet {budget}"},
    "spent_dining_over": {
        "en": " Dining is over budget. Cutting two takeaway meals a week would bring it back in line.",
        "zh": "餐饮超出预算了。每周少点两次外卖就能回到预算内。",
        "ms": " Makan di luar melebihi bajet. Kurangkan dua kali beli makanan seminggu untuk kembali ke bajet.",
    },
    "spent_cut": {"en": "In the last 30 days you spent {total}. The easiest places to cut: {list}.",
                  "zh": "过去 30 天你花了 {total}。最容易省钱的地方：{list}。",
                  "ms": "Dalam 30 hari lepas anda belanja {total}. Tempat paling mudah untuk jimat: {list}."},
    "spent_over_tag": {"en": ", over budget", "zh": "，超预算", "ms": ", melebihi bajet"},
    "spent_twice": {"en": " You were also charged twice by {list}; ask for one back.",
                    "zh": "另外 {list} 向你重复扣了款，可以要求退回一笔。",
                    "ms": " Anda juga dicaj dua kali oleh {list}; minta satu dikembalikan."},
    "budget_set": {"en": "Done. Your {category} budget is now CAD {amount} a month.",
                   "zh": "好了。你的{category}预算现在是每月 CAD {amount}。",
                   "ms": "Siap. Bajet {category} anda kini CAD {amount} sebulan."},
    "payees_list": {"en": "Your saved payees: {list}.", "zh": "你保存的收款人：{list}。",
                    "ms": "Penerima yang disimpan: {list}."},
    "tx_list": {"en": "Here are your latest {n} transactions; the most recent is {latest}.",
                "zh": "以下是你最近的 {n} 笔交易；最新一笔是 {latest}。",
                "ms": "Ini {n} transaksi terkini anda; yang terbaru ialah {latest}."},
    # Credit Builder
    # The credit card under the reply shows utilization, the statement, the streak and the next steps; the reply
    # gives the verdict, the one next step and the offer, then the disclosure.
    "credit_score_lead": {
        "en": "I can't see your credit score (HomeBridge doesn't pull one; Equifax and TransUnion Canada show it "
              "free), but ",
        "zh": "我看不到你的信用评分（HomeBridge 不查询征信评分，可在 Equifax 或 TransUnion Canada 免费查询），不过",
        "ms": "Saya tak nampak skor kredit anda (HomeBridge tidak menarik skor; Equifax dan TransUnion Canada "
              "tunjukkannya percuma), tetapi ",
    },
    "credit_now": {
        "en": "{lead}{your} {card} is at {util}% utilization (CAD {balance} of CAD {limit}); you've paid {streak} "
              "statements on time in a row, and its simulated health is {label}.",
        "zh": "{lead}你的 {card} 目前使用率为 {util}%（CAD {balance} / CAD {limit}），已连续 {streak} 期按时还款，模拟信用健康度为{label}。",
        "ms": "{lead}{card} anda pada penggunaan {util}% (CAD {balance} daripada CAD {limit}); anda telah bayar "
              "{streak} penyata tepat pada masa berturut-turut, dan kesihatan kredit simulasinya {label}.",
    },
    "credit_covers": {"en": "covers your CAD {remaining} statement due {due} and ",
                      "zh": "可还清 {due} 到期的 CAD {remaining} 账单，并",
                      "ms": "menampung penyata CAD {remaining} yang perlu dibayar {due} dan "},
    "credit_pay_rec": {
        "en": " Paying CAD {amount} now {covers}keeps what's reported under 30% ({after}%) when the statement closes "
              "on {close}; say '{cmd}' and I'll draft it.",
        "zh": "现在还 CAD {amount}，{covers}让 {close} 账单日上报的使用率低于 30%（{after}%）；说“{cmd}”，我就帮你起草。",
        "ms": " Bayar CAD {amount} sekarang {covers}kekalkan laporan di bawah 30% ({after}%) apabila penyata ditutup "
              "pada {close}; sebut '{cmd}' dan saya akan sediakan draf.",
    },
    "credit_keep": {
        "en": " Keep the balance under 30% of the limit when the statement closes, and keep paying on time.",
        "zh": "账单日时把余额保持在额度的 30% 以下，并继续按时还款。",
        "ms": " Kekalkan baki di bawah 30% had semasa penyata ditutup, dan terus bayar tepat pada masa.",
    },
    "credit_health": {
        "en": " This is not a credit score or personalised advice, and HomeBridge is not a licensed adviser.",
        "zh": "这不是信用评分，也不构成个性化建议；HomeBridge 不是持牌顾问。",
        "ms": " Ini bukan skor kredit atau nasihat peribadi, dan HomeBridge bukan penasihat berlesen.",
    },
    "credit_have_card": {
        "en": "You already have the usual first step: your {card}, a secured card with a CAD {limit} limit that "
              "reports to the bureaus, and you've paid {streak} statements on time over {months} months.",
        "zh": "你已经迈出了第一步：你的 {card} 是一张额度 CAD {limit} 的有担保信用卡，会向征信机构报告，你在 {months} 个月里已按时还款 {streak} 期。",
        "ms": "Anda sudah ada langkah pertama yang biasa: {card} anda, kad kredit bercagar dengan had CAD {limit} "
              "yang melapor kepada biro, dan anda telah bayar {streak} penyata tepat pada masa dalam {months} bulan.",
    },
    "credit_util_now": {
        "en": " Next, bring utilization down: you're at {util}%, and paying CAD {amount} takes you to {after}% (say "
              "'{cmd}' and I'll draft it).",
        "zh": "下一步是降低使用率：你现在是 {util}%，还 CAD {amount} 就能降到 {after}%（说“{cmd}”，我就帮你起草）。",
        "ms": " Seterusnya, turunkan penggunaan: anda pada {util}%, dan bayar CAD {amount} membawa anda ke {after}% "
              "(sebut '{cmd}' dan saya akan sediakan draf).",
    },
    "credit_next_keep": {
        "en": " Next, keep it under 30% and paid on time; the checklist below has the rest.",
        "zh": "下一步：保持使用率低于 30% 并按时还款；其余步骤见下方清单。",
        "ms": " Seterusnya, kekalkan di bawah 30% dan bayar tepat pada masa; senarai semak di bawah ada selebihnya.",
    },
    "credit_scratch": {"en": "Start with this: {step} The checklist below has the rest. {disclosure}",
                       "zh": "先从这一步开始：{step}其余步骤见下方清单。{disclosure}",
                       "ms": "Mulakan dengan ini: {step} Senarai semak di bawah ada selebihnya. {disclosure}"},
    "credit_disclosure": {
        "en": "General information, not personalised financial advice; HomeBridge is not a licensed adviser.",
        "zh": "以上为一般信息，不构成个性化理财建议；HomeBridge 不是持牌顾问。",
        "ms": "Maklumat umum, bukan nasihat kewangan peribadi; HomeBridge bukan penasihat berlesen.",
    },
    "card_after": {
        "en": " Once it goes through, your card balance drops to CAD {balance}, {util}% of your limit",
        "zh": "付款完成后，你的卡余额会降到 CAD {balance}，占额度的 {util}%",
        "ms": " Selepas ia berjaya, baki kad anda turun ke CAD {balance}, {util}% daripada had anda",
    },
    "card_under30": {"en": ", under the 30% mark before your statement closes on {close}.",
                     "zh": "，在 {close} 账单日之前低于 30%。",
                     "ms": ", di bawah paras 30% sebelum penyata ditutup pada {close}."},
    "card_over30": {
        "en": ". That is still above 30%; paying a bit more before {close} would help your utilization.",
        "zh": "。这仍高于 30%；在 {close} 之前再多还一点会改善你的使用率。",
        "ms": ". Itu masih melebihi 30%; bayar sedikit lagi sebelum {close} akan membantu penggunaan anda.",
    },
    "card_minimum": {
        "en": " The minimum keeps your on-time record, but interest is charged on the rest of the statement.",
        "zh": "只还最低额能保住按时还款记录，但账单余下部分会产生利息。",
        "ms": " Bayaran minimum mengekalkan rekod tepat masa, tetapi faedah dikenakan pada baki penyata.",
    },
    # Forecast. The runway card shows the chart, every suggestion and the tuition markers; the reply is the
    # verdict, the single most useful next step and the offer, in at most three sentences.
    "fc_short": {
        "en": "Not quite: on your usual spending, {account} dips below zero on {date} (lowest {lowest} on {low_date})",
        "zh": "不太够：按你平时的花销，{account}会在 {date} 跌破零（最低 {lowest}，在 {low_date}）",
        "ms": "Tak cukup: ikut perbelanjaan biasa anda, {account} jatuh bawah sifar pada {date} (paling rendah "
              "{lowest} pada {low_date})",
    },
    "fc_ok": {
        "en": "{verdict}: your spending money lasts to {end}, with the lowest point {lowest} on {low_date}",
        "zh": "{verdict}：你的日常开销能撑到 {end}，最低点是 {lowest}（{low_date}）",
        "ms": "{verdict}: wang belanja anda cukup sehingga {end}, paling rendah {lowest} pada {low_date}",
    },
    "fc_yes": {"en": "Yes", "zh": "够用", "ms": "Cukup"},
    "fc_mostly": {"en": "Mostly", "zh": "基本够用", "ms": "Hampir cukup"},
    "fc_gap": {
        "en": ", {join} your tuition fund will be {gap} short when {term} is due on {due}",
        "zh": "，{join}你的学费基金在 {term}（{due} 到期）时还差 {gap}",
        "ms": ", {join} dana yuran anda akan kurang {gap} apabila {term} perlu dibayar pada {due}",
    },
    "fc_and": {"en": "and", "zh": "而且", "ms": "dan"},
    "fc_but": {"en": "but", "zh": "不过", "ms": "tetapi"},
    "fc_covered": {"en": ", and your tuition fund covers the installment due {due}.",
                   "zh": "，学费基金够付 {due} 到期的那一期。",
                   "ms": ", dan dana yuran anda cukup untuk ansuran yang perlu dibayar {due}."},
    "fc_tip_convert": {
        "en": " Next step: convert about MYR {myr} into your {dest} by {by} to {why}; {provider} is cheapest ({pct}% "
              "true cost).",
        "zh": "下一步：在 {by} 前把约 MYR {myr} 换入你的{dest}，{why}；{provider}最便宜（真实成本 {pct}%）。",
        "ms": " Langkah seterusnya: tukar kira-kira MYR {myr} ke dalam {dest} anda sebelum {by} untuk {why}; "
              "{provider} paling murah (kos sebenar {pct}%).",
    },
    "fc_why_gap": {"en": "cover the CAD {gap} tuition gap", "zh": "以补上 CAD {gap} 的学费缺口",
                   "ms": "menampung kekurangan yuran CAD {gap}"},
    "fc_why_zero": {"en": "stay above zero", "zh": "让余额保持在零以上", "ms": "kekal di atas sifar"},
    "fc_tip_cut_dining": {"en": " Next step: cut dining by about CAD {n} a week, which alone keeps you above zero.",
                          "zh": "下一步：每周在外出就餐上少花约 CAD {n}，单这一项就能让余额保持为正。",
                          "ms": " Langkah seterusnya: kurangkan makan di luar kira-kira CAD {n} seminggu; itu sahaja "
                                "cukup untuk kekal di atas sifar."},
    "fc_tip_cut_all": {"en": " Next step: cut day-to-day spending by about CAD {n} a week, which alone keeps you "
                             "above zero.",
                       "zh": "下一步：每周日常开销减少约 CAD {n}，单这一项就能让余额保持为正。",
                       "ms": " Langkah seterusnya: kurangkan perbelanjaan harian kira-kira CAD {n} seminggu; itu "
                             "sahaja cukup untuk kekal di atas sifar."},
    "fc_tip_ask": {"en": " Next step: ask your dad for a top-up before {date}.", "zh": "下一步：在 {date} 之前请爸爸补一笔钱。",
                   "ms": " Langkah seterusnya: minta ayah tambah duit sebelum {date}."},
    "fc_tip_buffer": {
        "en": " It's tight, so keeping dining near its budget leaves more room.",
        "zh": "余额比较紧，把外出就餐控制在预算内会更宽松。",
        "ms": " Ia agak tipis, jadi kekalkan makan di luar dalam bajet untuk lebih ruang.",
    },
    "fc_end_offer": {
        "en": " I haven't moved any money; say '{offer}' and I'll draft that conversion for you to confirm.",
        "zh": "我没有动任何钱；说“{offer}”，我就起草这笔兑换，由你确认。",
        "ms": " Saya belum pindahkan apa-apa wang; sebut '{offer}' dan saya akan sediakan draf pertukaran itu untuk "
              "anda sahkan.",
    },
    "fc_end_ask": {"en": " I haven't moved any money; ask me if you want that conversion drafted for you to confirm.",
                   "zh": "我没有动任何钱；如果需要，我可以起草这笔兑换，由你确认。",
                   "ms": " Saya belum pindahkan apa-apa wang; minta saya jika mahu draf pertukaran itu untuk anda "
                         "sahkan."},
    "fc_end": {"en": " This is an estimate from your schedule and recent spending; I haven't moved any money.",
               "zh": "这是根据你的日程和近期花销做的估算；我没有动任何钱。",
               "ms": " Ini anggaran daripada jadual dan perbelanjaan terkini anda; saya belum pindahkan apa-apa wang."},
    # Pending
    "pending_mine": {"en": "Waiting for you to confirm: {list} (tap Confirm on its card)",
                     "zh": "等你确认：{list}（在卡片上点击确认）",
                     "ms": "Menunggu pengesahan anda: {list} (tekan Confirm pada kadnya)"},
    "pending_dad": {"en": "Waiting for your dad to approve in his app: {list}", "zh": "等爸爸在他的 App 里批准：{list}",
                    "ms": "Menunggu ayah anda luluskan dalam app dia: {list}"},
    "pending_approved": {"en": "Approved by your dad and done: {list}", "zh": "爸爸已批准并完成：{list}",
                         "ms": "Diluluskan oleh ayah anda dan selesai: {list}"},
    "pending_rejected": {"en": "Declined by your dad: {list}", "zh": "爸爸拒绝了：{list}",
                         "ms": "Ditolak oleh ayah anda: {list}"},
    "pending_done": {"en": "Done: {list}", "zh": "已完成：{list}", "ms": "Selesai: {list}"},
    "pending_none_dad": {"en": "Your dad hasn't approved anything recently, and nothing is waiting for him.",
                         "zh": "爸爸最近没有批准任何东西，也没有在等他处理的请求。",
                         "ms": "Ayah anda tidak meluluskan apa-apa baru-baru ini, dan tiada apa yang menunggu dia."},
    "pending_none": {"en": "Nothing is pending: no drafts waiting for you and nothing waiting for your dad.",
                     "zh": "目前没有待处理的事项：没有等你确认的草稿，也没有等爸爸批准的请求。",
                     "ms": "Tiada apa yang tertangguh: tiada draf menunggu anda dan tiada apa menunggu ayah anda."},
    # Privacy (from get_data_sharing: the sponsor's scope and where the chat goes)
    "privacy_no": {"en": "No. ", "zh": "看不到。", "ms": "Tidak. "},
    "privacy_yes": {"en": "Yes. ", "zh": "是的。", "ms": "Ya. "},
    "privacy_not_china": {"en": "No. ", "zh": "不会。", "ms": "Tidak. "},
    "privacy_sponsor": {
        "en": "Your dad sees only what you agreed to share when you signed up: the accounts he funds ({funded}), the "
              "requests you send him, safety alerts and a daily count of activity. Your CAD Everyday account, wages, "
              "spending and this chat stay private to you.",
        "zh": "爸爸只能看到你注册时同意分享的内容：他出资的账户（{funded}）、你发给他的请求、安全提醒和每天的活动次数。你的 CAD 日常账户、工资、消费和这段聊天只有你自己能看到。",
        "ms": "Ayah anda hanya nampak apa yang anda setuju kongsi semasa mendaftar: akaun yang dia biayai ({funded}), "
              "permintaan yang anda hantar kepadanya, amaran keselamatan dan kiraan aktiviti harian. Akaun CAD "
              "Everyday, gaji, perbelanjaan dan chat ini kekal peribadi untuk anda.",
    },
    "privacy_offline": {
        "en": " Replies right now come from HomeBridge's built-in engine, so nothing you type leaves our server.",
        "zh": "目前的回复来自 HomeBridge 内置引擎，你输入的内容不会离开我们的服务器。",
        "ms": " Jawapan sekarang datang daripada enjin terbina dalam HomeBridge, jadi apa yang anda taip tidak "
              "keluar dari pelayan kami.",
    },
    "privacy_cloud": {
        "en": " Replies come from {model} ({region}): the text you type goes there, and the account data it reads is "
              "masked; it never gets full account numbers, confirmation codes, compliance records or your dad's data.",
        "zh": "回复来自 {model}（{region}）：你输入的文字会发送到那里，它读取的账户数据经过脱敏；它永远拿不到完整账号、确认码、合规记录或爸爸的数据。",
        "ms": " Jawapan datang daripada {model} ({region}): teks yang anda taip dihantar ke sana, dan data akaun yang "
              "dibacanya disamarkan; ia tidak pernah dapat nombor akaun penuh, kod pengesahan, rekod pematuhan atau "
              "data ayah anda.",
    },
    "privacy_china_option": {
        "en": " If HomeBridge is switched to DeepSeek, your chat text would be processed in mainland China, which needs "
              "your consent; Qwen's Singapore endpoint or a self-hosted model keeps it out of China.",
        "zh": "如果 HomeBridge 改用 DeepSeek，你的聊天文字会在中国大陆处理，这需要你同意；使用通义千问新加坡节点或自托管模型则不会进入中国大陆。",
        "ms": " Jika HomeBridge ditukar kepada DeepSeek, teks chat anda akan diproses di tanah besar China, yang "
              "memerlukan persetujuan anda; titik akhir Qwen di Singapura atau model hos sendiri mengekalkannya di "
              "luar China.",
    },
    "privacy_log": {"en": " The audit log keeps events, never your message text.",
                    "zh": "审计日志只记录事件，从不保存你的消息内容。",
                    "ms": " Log audit menyimpan peristiwa sahaja, tidak pernah teks mesej anda."},
    "region_cn": {"en": "mainland China", "zh": "中国大陆", "ms": "tanah besar China"},
    "region_sg": {"en": "Singapore", "zh": "新加坡", "ms": "Singapura"},
    "region_self": {"en": "the operator's own servers", "zh": "运营方自己的服务器", "ms": "pelayan pengendali sendiri"},
    "region_server": {"en": "this server", "zh": "本服务器", "ms": "pelayan ini"},
    # Limits and tiers (from get_limits, so the numbers are the policy engine's)
    "limits_why": {
        "en": "Your dad approves payments above CAD {single}, anything over CAD {daily} in 24 hours, payments from "
              "the accounts he funds ({funded}), new payees and flagged requests. It's his money and his rule, and "
              "it also stops a scammer who gets you to tap Confirm.",
        "zh": "爸爸需要批准的有：单笔超过 CAD {single} 的付款、24 小时内合计超过 CAD {daily} 的付款、从他出资的账户（{funded}）付出的钱、新收款人，以及被标记为有风险的请求。这是他的钱、他定的规则，也能防止骗子诱导你点确认。",
        "ms": "Ayah anda meluluskan bayaran melebihi CAD {single}, apa-apa melebihi CAD {daily} dalam 24 jam, bayaran "
              "dari akaun yang dia biayai ({funded}), penerima baru dan permintaan yang ditanda berisiko. Ia wang "
              "dan peraturan dia, dan ia juga menghalang penipu yang memujuk anda menekan Confirm.",
    },
    "limits_why_tuition": {
        "en": "Your tuition payment goes to your dad for two reasons: it's paid from the CAD Tuition Fund, which he "
              "funds, and it's above the CAD {single} you can confirm alone. You confirm, then he approves in his "
              "own app, and a message in chat can't skip it.",
        "zh": "学费付款要经过爸爸批准有两个原因：它从爸爸出资的 CAD 学费基金付出，而且金额超过你可以自己确认的 CAD {single}。你先确认，再由他在自己的 App 里批准，聊天里的任何消息都跳不过这一步。",
        "ms": "Bayaran yuran anda pergi kepada ayah atas dua sebab: ia dibayar dari CAD Tuition Fund yang dia biayai, "
              "dan ia melebihi CAD {single} yang anda boleh sahkan sendiri. Anda sahkan, kemudian dia luluskan "
              "dalam app sendiri, dan mesej dalam chat tidak boleh melangkaunya.",
    },
    "limits_tiers": {
        "en": " T1: requests to your dad, which he decides. T2: you confirm alone (a saved payee, within CAD {single} "
              "each and CAD {daily} a day, nothing flagged). T3: you confirm, then he approves.",
        "zh": "T1：向爸爸提出的请求，由他决定。T2：你自己确认即可（已保存的收款人，单笔不超过 CAD {single}、每天不超过 CAD {daily}，且没有风险标记）。T3：你确认后，还需要爸爸批准。",
        "ms": " T1: permintaan kepada ayah, dia yang putuskan. T2: anda sahkan sendiri (penerima yang disimpan, tidak "
              "melebihi CAD {single} sekali bayar dan CAD {daily} sehari, tiada tanda risiko). T3: anda sahkan, "
              "kemudian ayah luluskan.",
    },
    "limits_now": {
        "en": "You can confirm up to CAD {single} per payment and CAD {daily} in 24 hours on your own; CAD {used} is "
              "used, so CAD {left} is left. Converting more than CAD {cap} of his money in 24 hours goes to him too.",
        "zh": "你自己可以确认单笔不超过 CAD {single}、24 小时内合计不超过 CAD {daily} 的付款；已用 CAD {used}，还剩 CAD {left}。24 小时内兑换超过 CAD {cap} 的爸爸出资的钱也要他批准。只有他能在自己的 App 里修改这些限额。",
        "ms": "Anda boleh sahkan sendiri sehingga CAD {single} sekali bayar dan CAD {daily} dalam 24 jam; CAD {used} "
              "sudah digunakan, jadi baki CAD {left}. Menukar lebih daripada CAD {cap} wang dia dalam 24 jam juga "
              "perlu kelulusannya. Hanya dia boleh ubah had ini, dalam app dia.",
    },
    # Questions about paying, answered from the data (they never draft)
    "card_due": {
        "en": "Your {card} statement of CAD {remaining} is due {due} (minimum CAD {minimum}).",
        "zh": "你的 {card} 账单 CAD {remaining} 将于 {due} 到期（最低还款 CAD {minimum}）。",
        "ms": "Penyata {card} anda sebanyak CAD {remaining} perlu dibayar {due} (minimum CAD {minimum}).",
    },
    "card_nothing_due": {
        "en": "Your {card} has no statement due right now; the next one closes on {close}.",
        "zh": "你的 {card} 目前没有到期账单；下一期账单日是 {close}。",
        "ms": "{card} anda tiada penyata yang perlu dibayar sekarang; penyata seterusnya ditutup pada {close}.",
    },
    "card_late": {
        "en": " Paying at least the minimum by the due date avoids a late fee, and paying the whole statement avoids "
              "interest. A payment 30 or more days late is reported to the credit bureaus and stays on your history "
              "for years, which hurts more than the fee.",
        "zh": "到期前至少还最低额可以避免滞纳金，还清整期账单可以避免利息。逾期 30 天以上会被报告给征信机构，并在信用记录上保留多年，影响比滞纳金更大。",
        "ms": " Bayar sekurang-kurangnya minimum sebelum tarikh akhir untuk elak caj lewat, dan bayar seluruh penyata "
              "untuk elak faedah. Bayaran lewat 30 hari atau lebih dilaporkan kepada biro kredit dan kekal dalam "
              "sejarah anda bertahun-tahun, yang lebih teruk daripada caj itu.",
    },
    "card_offer": {
        "en": " I haven't drafted anything; say '{cmd}' and I'll draft the payment for you to confirm.",
        "zh": "我没有起草任何付款；说“{cmd}”，我就起草，由你确认。",
        "ms": " Saya belum sediakan apa-apa draf; sebut '{cmd}' dan saya akan sediakan draf bayaran untuk anda sahkan.",
    },
    "rent_due": {
        "en": "Your last rent, {amount} to {payee}, went out on {date}. It's monthly, so the next one is due around "
              "{next}. Say '{offer}' when you're ready, or 'remind me to pay rent on {next}'.",
        "zh": "你上一次房租是 {date} 付给 {payee} 的 {amount}。房租按月交，所以下一次大约在 {next} 到期。准备好了就说“{offer}”。",
        "ms": "Sewa terakhir anda, {amount} kepada {payee}, dibayar pada {date}. Ia bulanan, jadi sewa seterusnya "
              "perlu dibayar sekitar {next}. Sebut '{offer}' bila anda bersedia.",
    },
    "rent_none": {"en": "I don't see a rent payment in the last 60 days.", "zh": "过去 60 天里没有看到房租付款。",
                  "ms": "Saya tak nampak bayaran sewa dalam 60 hari lepas."},
    "relay_saved": {
        "en": " Your saved payee {name} still has the account ending {last4}, and it can't change from chat: a new "
              "account would have to be added as a new payee, which your dad approves, followed by a cooling period. "
              "Call {name} on a number you already have before paying anything new.",
        "zh": "你保存的收款人 {name} 的账户尾号仍是 {last4}，聊天里改不了：新账户必须作为新收款人添加，由爸爸批准，之后还有冷静期。付款前请用你原有的号码联系 {name} 核实。",
        "ms": " Penerima simpanan anda {name} masih menggunakan akaun berakhir {last4}, dan ia tidak boleh ditukar "
              "melalui chat: akaun baru perlu ditambah sebagai penerima baru, yang ayah anda luluskan, diikuti "
              "tempoh bertenang. Hubungi {name} melalui nombor yang anda sudah ada sebelum membayar apa-apa.",
    },
    "relay_none": {
        "en": " I haven't drafted anything. If you decide to pay, say so and I'll draft it to your saved payee.",
        "zh": "我没有起草任何付款。如果你决定付款，告诉我，我会起草付给你已保存的收款人。",
        "ms": " Saya belum sediakan apa-apa draf. Jika anda mahu bayar, beritahu saya dan saya akan sediakan draf "
              "kepada penerima simpanan anda.",
    },
    # Greeting and fallback
    "hello": {
        "en": "Hi{name}! I can check your balances and spending, compare the true cost of moving money between MYR and "
              "CAD, plan for tuition, and draft payments, conversions and requests to your dad, which you always "
              "confirm yourself in the app. I can also set reminders, help you build credit and check suspicious "
              "messages. Try 'pay rent', 'cheapest way to send 3,000 MYR to CAD' or 'will I run out of money before "
              "tuition?'",
        "zh": "你好{name}！我可以帮你查余额和开销、比较马币和加币之间汇款的真实成本、规划学费，还能起草付款、兑换和向爸爸要钱的请求，"
              "这些都由你自己在 App 里确认。我也能设提醒、帮你建立信用、检查可疑信息。试试说“交房租”“最便宜的马币换加币”或“我的钱够用到学期末吗？”",
        "ms": "Hai{name}! Saya boleh semak baki dan perbelanjaan, bandingkan kos sebenar memindahkan wang antara MYR "
              "dan CAD, rancang yuran, dan sediakan draf bayaran, pertukaran dan permintaan kepada ayah, yang anda "
              "sentiasa sahkan sendiri dalam app. Cuba 'bayar sewa', 'cara paling murah tukar 3,000 MYR ke CAD' atau "
              "'duit cukup tak sampai hujung sem?'",
    },
    "fallback_guess": {"en": "I didn't catch that. Did you mean '{guess}'? You can also try {tries}.",
                       "zh": "我没听懂。你是想问“{guess}”吗？也可以试试{tries}。",
                       "ms": "Saya tak faham. Maksud anda '{guess}'? Anda juga boleh cuba {tries}."},
    "fallback": {
        "en": "I didn't catch that. I can help with balances, spending, tuition, exchange rates, payments, credit and "
              "suspicious messages. Try {tries}.",
        "zh": "我没听懂。我可以帮你查余额、开销、学费、汇率、付款、信用和可疑信息。试试说{tries}。",
        "ms": "Saya tak faham. Saya boleh bantu dengan baki, perbelanjaan, yuran, kadar tukaran, bayaran, kredit dan "
              "mesej mencurigakan. Cuba {tries}.",
    },
}

# Example prompts for the fallback in each language. Every one routes in the offline engine.
FALLBACK_EXAMPLES = {
    "zh": ["我还有多少钱？", "交房租", "最便宜的马币换加币", "我的钱够用到学期末吗？"],
    "ms": ["berapa baki saya?", "bayar sewa", "cara paling murah tukar 3,000 MYR ke CAD", "duit cukup tak sampai hujung sem?"],
}

# Offers the engine makes ("say X and I'll draft it"), as the user would say them in each language. Each one
# routes to the same plan as the English offer.
OFFERS = {
    "cover the tuition shortfall from my MYR wallet": {"zh": "用马币钱包补上学费缺口",
                                                       "ms": "tampung kekurangan yuran dari dompet MYR saya"},
    "pay rent": {"zh": "交房租", "ms": "bayar sewa"},
    "pay my card": {"zh": "还我的信用卡", "ms": "bayar kad kredit saya"},
}


def t(key: str, lang: str, **kw: Any) -> str:
    row = TEXT[key]
    return (row.get(lang) or row["en"]).format(**kw)


def offer(text: str, lang: str) -> str:
    """An offer phrase in the user's language ('convert 3887 MYR to CAD' -> '把3887马币换成加币')."""
    if lang == "en":
        return text
    if text in OFFERS:
        return OFFERS[text].get(lang, text)
    m = re.fullmatch(r"convert ([\d.]+) MYR to CAD", text)
    if m:
        return t("convert_cmd", lang, n=m.group(1))
    return text


def quote(s: str, lang: str) -> str:
    """'x' in English and Malay, “x” in Chinese."""
    return f"“{s}”" if lang == "zh" else f"'{s}'"


def or_list(items: List[str], lang: str) -> str:
    """'a', 'b' or 'c' (quoted), in the user's language."""
    q = [quote(i, lang) for i in items]
    if lang == "zh":
        return "、".join(q[:-1]) + "或" + q[-1] if len(q) > 1 else q[0]
    word = " atau " if lang == "ms" else " or "
    return ", ".join(q[:-1]) + word + q[-1] if len(q) > 1 else q[0]


def and_list(items: List[str], lang: str) -> str:
    if len(items) < 2:
        return "".join(items)
    if lang == "zh":
        return "、".join(items[:-1]) + " 和 " + items[-1]
    return ", ".join(items[:-1]) + (" dan " if lang == "ms" else " and ") + items[-1]


def sep(lang: str) -> str:
    """Separator between items of a list in a sentence."""
    return "；" if lang == "zh" else "; "


def comma(lang: str) -> str:
    return "、" if lang == "zh" else ", "


# ------------------------------------------------------------------ sandbox vocabulary
ACCOUNTS = {
    "zh": {"CAD Everyday": "CAD 日常账户", "MYR Wallet": "马币钱包", "CAD Tuition Fund": "CAD 学费基金",
           "Tuition Fund": "学费基金", "HomeBridge Secured Card": "HomeBridge 有担保信用卡"},
}
CATEGORIES = {
    "zh": {"rent": "房租", "groceries": "日用杂货", "dining": "餐饮", "family": "家庭", "transport": "交通",
           "utilities": "水电", "phone": "话费", "entertainment": "娱乐", "shopping": "购物", "tuition": "学费",
           "income": "收入", "allowance": "生活费", "books": "书本", "health": "医疗", "travel": "旅行",
           "subscriptions": "订阅", "conversion": "兑换", "other": "其他"},
    "ms": {"rent": "sewa", "groceries": "barang dapur", "dining": "makan di luar", "family": "keluarga",
           "transport": "pengangkutan", "utilities": "utiliti", "phone": "telefon", "entertainment": "hiburan",
           "shopping": "membeli-belah", "tuition": "yuran", "income": "pendapatan", "allowance": "elaun",
           "books": "buku", "health": "kesihatan", "travel": "perjalanan", "subscriptions": "langganan",
           "other": "lain-lain"},
}
PROVIDERS = {
    "zh": {"HomeBridge wallet conversion": "HomeBridge 钱包内兑换", "Low-cost transfer service": "低成本汇款服务",
           "Bank telegraphic transfer": "银行电汇", "Airport money changer": "机场换汇柜台",
           "Express remittance service": "快速汇款服务", "Instant domestic transfer": "境内即时转账",
           "Interbank GIRO transfer": "银行间 GIRO 转账"},
    "ms": {"HomeBridge wallet conversion": "pertukaran dompet HomeBridge",
           "Low-cost transfer service": "perkhidmatan pindahan kos rendah",
           "Bank telegraphic transfer": "pindahan telegrafik bank", "Airport money changer": "pengurup wang lapangan terbang",
           "Express remittance service": "perkhidmatan kiriman wang ekspres",
           "Instant domestic transfer": "pindahan segera dalam negara", "Interbank GIRO transfer": "pindahan GIRO antara bank"},
}
SPEEDS = {
    "zh": {"instant": "即时到账", "1 business day": "1 个工作日", "2 to 4 business days": "2 至 4 个工作日",
           "in person": "需现场办理", "same day": "当天到账"},
    "ms": {"instant": "segera", "1 business day": "1 hari bekerja", "2 to 4 business days": "2 hingga 4 hari bekerja",
           "in person": "secara bersemuka", "same day": "hari yang sama"},
}
HEALTH = {
    "zh": {"needs_attention": "需要注意", "fair": "一般", "on_track": "良好", "strong": "优秀"},
    "ms": {"needs_attention": "Perlu perhatian", "fair": "Sederhana", "on_track": "Di landasan", "strong": "Kukuh"},
}
SIGNALS = {
    "zh": {
        "'Safe account' police scam": "“安全账户”冒充警方诈骗",
        "Accuses you of a crime": "指控你涉嫌犯罪",
        "Asks for a wire transfer service": "要求通过电汇服务付款",
        "Asks for crypto": "要求用加密货币付款",
        "Asks for gift cards": "要求用礼品卡付款",
        "Asks you to keep it secret": "要求你保密",
        "Asks you to pass money on for someone": "要求你替别人转钱",
        "Asks you to send money to the police": "要求你把钱转给“警方”",
        "Bank details changed by message": "通过消息更改银行账户",
        "Deposit a cheque, send back the difference": "存支票后退回差额",
        "Deposit for a home you can't see": "为看不到的房子付押金",
        "Family emergency, money needed now": "家人急事、马上要钱",
        "Fee to release money or a prize": "先交费才能领钱或奖品",
        "Friend asking to borrow money by message": "朋友发消息借钱",
        "Impersonates a government agency": "冒充政府机构",
        "Impersonates police, courts or an embassy": "冒充警方、法院或使领馆",
        "Job that asks you to pay first": "先交钱的工作",
        "Message from a 'new number' asking for money": "“新号码”发消息要钱",
        "Parcel or customs problem passed to 'police'": "包裹或海关问题被转给“警方”",
        "Promises guaranteed returns": "承诺保证收益",
        "Says you won a prize": "声称你中了奖",
        "Threat of arrest or deportation": "以逮捕或遣返相威胁",
        "Urgent deadline to pay": "催你在限期内付款",
    },
    "ms": {
        "'Safe account' police scam": "scam polis 'akaun selamat'",
        "Accuses you of a crime": "menuduh anda melakukan jenayah",
        "Asks for a wire transfer service": "minta bayaran melalui perkhidmatan pindahan wang",
        "Asks for crypto": "minta bayaran kripto",
        "Asks for gift cards": "minta kad hadiah",
        "Asks you to keep it secret": "minta anda rahsiakan",
        "Asks you to send money to the police": "minta anda hantar wang kepada 'polis'",
        "Bank details changed by message": "butiran bank ditukar melalui mesej",
        "Family emergency, money needed now": "kecemasan keluarga, perlu wang segera",
        "Fee to release money or a prize": "yuran untuk melepaskan wang atau hadiah",
        "Impersonates a government agency": "menyamar sebagai agensi kerajaan",
        "Impersonates police, courts or an embassy": "menyamar sebagai polis, mahkamah atau kedutaan",
        "Job that asks you to pay first": "kerja yang minta anda bayar dulu",
        "Says you won a prize": "kata anda menang hadiah",
        "Threat of arrest or deportation": "ugutan tangkap atau hantar pulang",
        "Urgent deadline to pay": "tarikh akhir mendesak untuk bayar",
    },
}
CREDIT_STEPS = {
    "zh": {
        "Get a Social Insurance Number if your study permit allows work; lenders often ask for it.":
            "如果你的学签允许打工，先办社会保险号（SIN）；贷款机构经常需要它。",
        "Open a student or secured credit card with a low limit. A secured card needs a refundable deposit and reports "
        "to the credit bureaus like a normal card.":
            "开一张低额度的学生卡或有担保信用卡。有担保信用卡需要一笔可退还的押金，并像普通信用卡一样向征信机构报告。",
        "Put one small recurring bill on the card (e.g. the phone plan) and set autopay for the full statement balance.":
            "把一笔小额固定账单（比如话费）绑在卡上，并设置自动全额还款。",
        "Keep the balance under about 30% of the limit at statement time.": "账单日时把余额保持在额度的 30% 左右以下。",
        "Never miss a payment; payment history is the largest factor in a credit score.": "绝不要逾期还款；还款记录是信用评分中最重要的因素。",
        "Check your report for free from Equifax and TransUnion Canada once you have a few months of history.":
            "有几个月记录后，可以在 Equifax 和 TransUnion Canada 免费查看你的信用报告。",
        "Avoid applying for many cards at once; each hard inquiry has a small effect.": "不要一次申请很多张卡；每次硬查询都会有一点影响。",
    },
    "ms": {
        "Put one small recurring bill on the card (e.g. the phone plan) and set autopay for the full statement balance.":
            "Letak satu bil kecil berulang pada kad (contohnya pelan telefon) dan tetapkan autopay untuk baki penuh "
            "penyata.",
        "Keep the balance under about 30% of the limit at statement time.":
            "Kekalkan baki di bawah kira-kira 30% had semasa penyata.",
        "Never miss a payment; payment history is the largest factor in a credit score.":
            "Jangan sekali-kali terlepas bayaran; sejarah bayaran ialah faktor terbesar dalam skor kredit.",
    },
}
_ZH_MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct",
                                               "nov", "dec"])}
_MS_MONTHS = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"]
_EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _lookup(table: Dict[str, Dict[str, str]], value: str, lang: str) -> str:
    return table.get(lang, {}).get(value, value)


def account(label: str, lang: str) -> str:
    return _lookup(ACCOUNTS, label, lang)


def category(name: str, lang: str) -> str:
    return _lookup(CATEGORIES, name, lang)


def provider(name: str, lang: str) -> str:
    return _lookup(PROVIDERS, name, lang)


def speed(s: str, lang: str) -> str:
    return _lookup(SPEEDS, s, lang)


def health(key: str, label: str, lang: str) -> str:
    return HEALTH.get(lang, {}).get(key, label)


def signal(name: str, lang: str) -> str:
    return _lookup(SIGNALS, name, lang)


def credit_step(s: str, lang: str) -> str:
    return _lookup(CREDIT_STEPS, s, lang)


def date(iso: str, lang: str) -> str:
    """'2026-12-16' -> 'Dec 16' (en), '12月16日' (zh), '16 Dis' (ms)."""
    y, mo, d = iso[:10].split("-")
    if lang == "zh":
        return f"{int(mo)}月{int(d)}日"
    if lang == "ms":
        return f"{int(d)} {_MS_MONTHS[int(mo) - 1]}"
    return f"{_EN_MONTHS[int(mo) - 1]} {int(d)}"


def term(name: str, lang: str) -> str:
    """'Winter Term 2, installment 1' -> '冬季第2学期第1期' (zh), 'Winter Term 2, ansuran 1' (ms)."""
    m = re.fullmatch(r"(Winter|Summer|Fall|Spring) Term (\d), installment (\d)", name or "")
    if not m:
        return name
    if lang == "zh":
        season = {"Winter": "冬季", "Summer": "夏季", "Fall": "秋季", "Spring": "春季"}[m.group(1)]
        return f"{season}第{m.group(2)}学期第{m.group(3)}期"
    if lang == "ms":
        return f"{m.group(1)} Term {m.group(2)}, ansuran {m.group(3)}"
    return name


_SUMMARIES = [
    (re.compile(r"Pay (\w{3} [\d,.]+) to (.+) from (.+)"),
     {"zh": "从 {2} 向 {1} 支付 {0}", "ms": "Bayar {0} kepada {1} dari {2}"}),
    (re.compile(r"Move (\w{3} [\d,.]+) from (.+) to (.+)"),
     {"zh": "把 {0} 从 {1} 转到 {2}", "ms": "Pindah {0} dari {1} ke {2}"}),
    (re.compile(r"Convert (\w{3} [\d,.]+) to about (\w{3} [\d,.]+) \((.+) to (.+)\)"),
     {"zh": "把 {0} 兑换成约 {1}（{2} → {3}）", "ms": "Tukar {0} kepada kira-kira {1} ({2} ke {3})"}),
    (re.compile(r"Ask sponsor for (\w{3} [\d,.]+): (.*)"),
     {"zh": "向担保人申请 {0}：{1}", "ms": "Minta penaja {0}: {1}"}),
    (re.compile(r"Add new payee (.+)"), {"zh": "添加新收款人 {0}", "ms": "Tambah penerima baharu {0}"}),
]


def summary(s: str, lang: str) -> str:
    """An action summary from the policy engine, in the user's language (account labels translated too)."""
    if lang == "en":
        return s
    for pat, tpl in _SUMMARIES:
        m = pat.fullmatch(s or "")
        if m and lang in tpl:
            return tpl[lang].format(*[account(g, lang) for g in m.groups()])
    return s


_WARNINGS = [
    (re.compile(r"Balance in (.+) is lower than this amount(?: right now)?; it will fail( unless topped up(?: first)?)?\."),
     {"zh": "{0}的余额低于这笔金额，除非先补足，否则会失败。",
      "ms": "Baki dalam {0} lebih rendah daripada jumlah ini; ia akan gagal kecuali ditambah."}),
    (re.compile(r"Rate ([\d.]+) includes a ([\d.]+)% margin over mid-market \(([\d.]+)\)\."),
     {"zh": "汇率 {0} 含有比中间价（{2}）高 {1}% 的汇差。",
      "ms": "Kadar {0} termasuk margin {1}% di atas kadar tengah ({2})."}),
    (re.compile(r"Check the payee and amount against an official source before confirming\."),
     {"zh": "确认前请对照官方来源核对收款人和金额。", "ms": "Semak penerima dan jumlah dengan sumber rasmi sebelum mengesahkan."}),
    (re.compile(r"This request matches a known scam pattern\. Legitimate agencies never demand urgent payment by chat\."),
     {"zh": "这个请求符合已知的诈骗模式。正规机构绝不会通过聊天催你紧急付款。",
      "ms": "Permintaan ini sepadan dengan corak scam yang diketahui. Agensi sah tidak pernah menuntut bayaran segera "
            "melalui chat."}),
]


def warning(w: str, lang: str) -> str:
    if lang == "en":
        return w
    for pat, tpl in _WARNINGS:
        m = pat.fullmatch(w)
        if m and lang in tpl:
            return tpl[lang].format(*[account(g or "", lang) for g in m.groups()])
    return w


def is_bare_request(text: str) -> bool:
    """'Is this a scam?' or '帮我查一下这条信息是不是诈骗' with no message to check."""
    s = (text or "").strip()
    if re.search(r"['\"“”‘’「」『』:：\n$]|https?://|www\.|\d", s):
        return False
    # Words that belong to the message being asked about, not to the request itself
    if re.search(r"\b(pay|paid|send|owe|fee|fees|account|bank|arrest|police|gift|crypto|bitcoin|win|won|prize|"
                 r"transfer|deposit|tax|taxes|parcel|job|offer|urgent|bayar|akaun|polis|hadiah)\b|"
                 r"转|付|钱|账户|账号|银行|警|海关|中奖|验证码|包裹|税|工作", s.lower()):
        return False
    if _CJK.search(s):
        return len(s) <= 24
    return len(re.findall(r"[a-z]+", s.lower())) <= 8
