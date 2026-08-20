-- Marca convidados adicionados na hora (fora da lista original), no check-in
ALTER TABLE reservation_guests   ADD COLUMN IF NOT EXISTS is_extra boolean NOT NULL DEFAULT false;
ALTER TABLE promoter_list_guests ADD COLUMN IF NOT EXISTS is_extra boolean NOT NULL DEFAULT false;
