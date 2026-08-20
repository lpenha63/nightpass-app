-- O CHECK travava em 5 tipos antigos. O app já manda 'task_assigned' e 'direct'
-- (src/utils/whatsapp.ts) e agora 'ticket_delivery' — todos falhavam ao gravar o log,
-- em silêncio, porque o insert fica dentro de try/catch. Libera os tipos realmente usados.
ALTER TABLE whatsapp_logs DROP CONSTRAINT IF EXISTS whatsapp_logs_message_type_check;
ALTER TABLE whatsapp_logs ADD CONSTRAINT whatsapp_logs_message_type_check
  CHECK (message_type = ANY (ARRAY[
    'checkin_confirm','birthday_wish','event_invite','promoter_qr','custom',
    'direct','task_assigned','ticket_delivery'
  ]));
