require('dotenv').config();

const { Bot, InlineKeyboard, Keyboard } = require('grammy');
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { readVlessSubscriptionUrl } = require('./subscription');

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  console.error('Укажите TELEGRAM_BOT_TOKEN в файле .env.');
  process.exit(1);
}

const adminChatId = process.env.ADMIN_CHAT_ID?.trim();
const webAppUrl = process.env.WEB_APP_URL?.trim();
const port = Number(process.env.PORT) || 3000;
const vlessSubscriptionUrl = readVlessSubscriptionUrl();
const currency = '⭐';
const supportUsername = process.env.SUPPORT_USERNAME?.trim().replace(/^@/, '');
const plans = [
  { id: '1m', title: '1 месяц', months: 1, price: Number(process.env.STARS_PRICE_1M) || 75 },
  { id: '3m', title: '3 месяца', months: 3, price: Number(process.env.STARS_PRICE_3M) || 225 },
  { id: '6m', title: '6 месяцев', months: 6, price: Number(process.env.STARS_PRICE_6M) || 450 },
  { id: '12m', title: '1 год', months: 12, price: Number(process.env.STARS_PRICE_12M) || 900 },
];
const salesEnabled = Boolean(vlessSubscriptionUrl);

const bot = new Bot(token);
const processedPayments = new Set();
const web = express();

if (webAppUrl) {
  let parsedWebAppUrl;
  try {
    parsedWebAppUrl = new URL(webAppUrl);
  } catch {
    console.error('WEB_APP_URL должен быть полным HTTPS URL.');
    process.exit(1);
  }
  if (parsedWebAppUrl.protocol !== 'https:') {
    console.error('WEB_APP_URL должен использовать HTTPS.');
    process.exit(1);
  }
}

web.get('/api/plans', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ currency, plans, salesEnabled });
});
web.use(express.static(path.join(__dirname, 'webapp')));
web.listen(port, '0.0.0.0', () => {
  console.log(`Dom.VPN Mini App server listening on port ${port}.`);
});

function tariffKeyboard() {
  const keyboard = new InlineKeyboard();
  for (const plan of plans) {
    keyboard.text(plan.title, `plan:${plan.id}`).row();
  }
  if (supportUsername) {
    keyboard.url('Поддержка', `https://t.me/${supportUsername}`);
  }
  return keyboard;
}

function planById(id) {
  return plans.find((plan) => plan.id === id);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

bot.command('start', async (ctx) => {
  if (webAppUrl) {
    await ctx.reply('Dom.VPN\nОткройте магазин и выберите срок подписки:', {
      reply_markup: new Keyboard().webApp('Открыть магазин', webAppUrl).resized().persistent(),
    });
    return;
  }
  await ctx.reply('Dom.VPN\nВыберите тариф. Для Mini App задайте WEB_APP_URL в .env:', {
    reply_markup: tariffKeyboard(),
  });
});

bot.command('terms', async (ctx) => {
  await ctx.reply(
    'Условия Dom.VPN\n\n' +
      'Покупая тариф, вы оплачиваете цифровую VPN-подписку на выбранный срок. ' +
      'После подтверждения платежа Telegram бот выдаёт конфигурацию VLESS. ' +
      'Сейчас конфигурация общая для всех покупателей: доступ нельзя отключить отдельно для одного пользователя по окончании срока. ' +
      'Используйте VPN в соответствии с законами вашей страны. ' +
      'Если доступ не выдан или возник вопрос по оплате, отправьте /paysupport. ' +
      'Оплата цифровой услуги в Telegram выполняется только Telegram Stars.',
  );
});

bot.command('paysupport', async (ctx) => {
  const supportText = supportUsername
    ? `По вопросам платежа напишите @${supportUsername}.`
    : 'По вопросам платежа ответьте на это сообщение и укажите дату покупки и тариф.';
  await ctx.reply(supportText);
});

bot.command('id', async (ctx) => {
  await ctx.reply(`Ваш Telegram ID: ${ctx.chat.id}`);
});

bot.command('cancel', async (ctx) => {
  await ctx.reply('Заявка отменена.', { reply_markup: { remove_keyboard: true } });
});

bot.callbackQuery('tariffs', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('Dom.VPN\nВыберите срок подписки:', {
    reply_markup: tariffKeyboard(),
  });
});

bot.callbackQuery(/^plan:(.+)$/, async (ctx) => {
  const plan = planById(ctx.match[1]);
  await ctx.answerCallbackQuery();
  if (!plan) {
    await ctx.reply('Этот тариф сейчас недоступен. Откройте /start и выберите другой.');
    return;
  }

  const priceText = `Стоимость: ${plan.price} ${currency}`;
  const keyboard = new InlineKeyboard()
    .text('Продолжить', `order:${plan.id}`)
    .row()
    .text('Назад к тарифам', 'tariffs');

  await ctx.editMessageText(`Dom.VPN · ${plan.title}\n${priceText}`, {
    reply_markup: keyboard,
  });
});

bot.callbackQuery(/^order:(.+)$/, async (ctx) => {
  const plan = planById(ctx.match[1]);
  await ctx.answerCallbackQuery();
  if (!plan) {
    await ctx.reply('Этот тариф сейчас недоступен. Откройте /start и выберите другой.');
    return;
  }
  await showTermsForPurchase(ctx, plan);
});

async function showTermsForPurchase(ctx, plan) {
  const keyboard = new InlineKeyboard().text(
    `Принимаю условия · оплатить ${plan.price} ⭐`,
    `pay:${plan.id}`,
  );
  await ctx.reply(
    `Dom.VPN · ${plan.title}\nЦена: ${plan.price} ⭐\n\n` +
      'Покупая, вы соглашаетесь с условиями /terms. VPN-доступ будет предоставлен после подтверждения оплаты.',
    { reply_markup: keyboard },
  );
}

async function sendPlanInvoice(ctx, plan) {
  const payload = `domvpn|${ctx.from.id}|${plan.id}|${crypto.randomUUID()}`;
  await ctx.api.sendInvoice(
    ctx.chat.id,
    `Dom.VPN — ${plan.title}`,
    `VPN-подписка Dom.VPN на ${plan.title.toLowerCase()}`,
    payload,
    '',
    'XTR',
    [{ label: plan.title, amount: plan.price }],
    { start_parameter: `vpn-${plan.id}` },
  );
}

function parseInvoicePayload(payload) {
  const [prefix, userId, planId, nonce] = payload.split('|');
  if (prefix !== 'domvpn' || !/^\d+$/.test(userId || '') || !nonce) return null;
  return { userId, planId };
}

bot.callbackQuery(/^pay:(.+)$/, async (ctx) => {
  const plan = planById(ctx.match[1]);
  if (!plan) {
    await ctx.answerCallbackQuery({ text: 'Тариф недоступен. Откройте /start и выберите другой.', show_alert: true });
    return;
  }
  if (!salesEnabled) {
    await ctx.answerCallbackQuery({
      text: 'Покупка отключена: Railway не получил VLESS_SUBSCRIPTION_URL.',
      show_alert: true,
    });
    return;
  }
  await ctx.answerCallbackQuery({ text: 'Создаю счёт в Telegram Stars…' });
  try {
    await sendPlanInvoice(ctx, plan);
  } catch (error) {
    console.error('Telegram Stars invoice failed:', error.message);
    await ctx.reply('Telegram не смог создать счёт Stars. Проверьте Railway Deploy Logs или попробуйте позже.');
    if (adminChatId) {
      await bot.api.sendMessage(adminChatId, `Не удалось создать Stars-счёт. Ошибка Telegram: ${error.message}`);
    }
  }
});

bot.on('pre_checkout_query', async (ctx) => {
  const query = ctx.preCheckoutQuery;
  const payload = parseInvoicePayload(query.invoice_payload);
  const plan = payload && planById(payload.planId);
  let valid = Boolean(payload &&
    payload.userId === String(ctx.from.id) &&
    plan &&
    query.currency === 'XTR' &&
    query.total_amount === plan.price &&
    salesEnabled);

  await ctx.answerPreCheckoutQuery(
    Boolean(valid),
    valid ? undefined : 'Заказ временно недоступен. Проверьте подключение и попробуйте позже.',
  );
});

bot.on('message:successful_payment', async (ctx) => {
  const payment = ctx.message.successful_payment;
  const payload = parseInvoicePayload(payment.invoice_payload);
  const plan = payload && planById(payload.planId);
  const valid = payload &&
    payload.userId === String(ctx.from.id) &&
    plan &&
    payment.currency === 'XTR' &&
    payment.total_amount === plan.price &&
    salesEnabled;

  if (!valid) {
    await ctx.reply('Платёж получен, но заказ не прошёл проверку. Обратитесь в /paysupport.');
    if (adminChatId) {
      await bot.api.sendMessage(adminChatId, `Платёж Dom.VPN требует проверки вручную. Telegram charge ID: ${payment.telegram_payment_charge_id}`);
    }
    return;
  }

  if (processedPayments.has(payment.telegram_payment_charge_id)) return;

  if (adminChatId) {
    bot.api.sendMessage(
      adminChatId,
      `Оплата подтверждена Telegram Stars\nТариф: ${plan.title}\nСумма: ${payment.total_amount} ⭐\nTelegram ID: ${ctx.from.id}\nCharge ID: ${payment.telegram_payment_charge_id}\nВыдаю VLESS-конфигурацию...`,
    ).catch((error) => console.error('Admin notification failed:', error.message));
  }

  try {
    await ctx.reply(
      `Оплата подтверждена. Подписка Dom.VPN «${plan.title}» активна.\n\n` +
        `Скопируйте ссылку в совместимый VPN-клиент:\n<code>${escapeHtml(vlessSubscriptionUrl)}</code>`,
      { parse_mode: 'HTML' },
    );
    processedPayments.add(payment.telegram_payment_charge_id);
  } catch (error) {
    console.error('VLESS delivery failed:', error.message);
    await ctx.reply('Оплата получена, но выдача конфигурации не завершилась. Обратитесь в /paysupport.');
    if (adminChatId) {
      await bot.api.sendMessage(
        adminChatId,
        `Срочно: не отправлена VLESS-конфигурация после подтверждённой оплаты.\nTelegram ID: ${ctx.from.id}\nТариф: ${plan.title}\nCharge ID: ${payment.telegram_payment_charge_id}\nОшибка: ${error.message}`,
      );
    }
  }
});

bot.on('message:web_app_data', async (ctx) => {
  let data;
  try {
    data = JSON.parse(ctx.message.web_app_data.data);
  } catch {
    await ctx.reply('Не удалось прочитать заказ. Откройте магазин и попробуйте ещё раз.');
    return;
  }

  if (data?.action !== 'order' || typeof data.planId !== 'string') {
    await ctx.reply('Неизвестный заказ. Откройте магазин и выберите тариф заново.');
    return;
  }

  const plan = planById(data.planId);
  if (!plan) {
    await ctx.reply('Этот тариф недоступен. Откройте магазин и выберите другой.');
    return;
  }

  await showTermsForPurchase(ctx, plan);
});

bot.catch((error) => {
  console.error('Ошибка Telegram-бота:', error.message);
});

bot.start();
console.log('Dom.VPN бот запущен.');