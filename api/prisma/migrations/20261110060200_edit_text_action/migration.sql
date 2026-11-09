-- Lead ruling LF, 9 Nov: a longer edit of a paid message is a charge of its own kind (one value added).
ALTER TYPE "ChargeAction" ADD VALUE IF NOT EXISTS 'EDIT_TEXT';
