-- Histórico de veículos (antes na planilha "Controle de Entrada e Saída").
CREATE TABLE "Vehicle" (
  "id" TEXT NOT NULL,
  "plate" TEXT,
  "model" TEXT NOT NULL,
  "km" INTEGER,
  "year" TEXT,
  "purchaseDate" TIMESTAMP(3),
  "saleDate" TIMESTAMP(3),
  "purchasePrice" DOUBLE PRECISION,
  "salePrice" DOUBLE PRECISION,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VehicleExpense" (
  "id" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "date" TIMESTAMP(3),
  "description" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VehicleExpense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VehicleExpense_vehicleId_idx" ON "VehicleExpense"("vehicleId");
ALTER TABLE "VehicleExpense" ADD CONSTRAINT "VehicleExpense_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carros da aba "Historico (2)" a partir de 29/09/2026. A coluna "Custo" vira um gasto lançado.
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_01','BBC5H02','VOYAGE CINZA FAST BACACHERI','2016/2017','2026-09-29 12:00:00','2026-10-08 12:00:00',36500,38000,NULL,CURRENT_TIMESTAMP);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_02','AYQ8E47','LOGAN EXPRESSION PRATA 1.0 16V VAAPT BOQUEIRÃO','2014/2014','2026-09-29 12:00:00','2026-10-05 12:00:00',21000,22500,NULL,CURRENT_TIMESTAMP);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_03','DMI9H77','PEUGEOT 307 PRESENCE 1.6 16V PRETO DESAPEGA HAUER','2008/2008','2026-09-30 12:00:00','2026-11-07 12:00:00',12500,12500,NULL,CURRENT_TIMESTAMP);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_04','AYZ3656','VERSA SL 1.6 16V FLEX MANUAL PRETO FAST BATEL','2014/2014','2026-10-01 12:00:00',NULL,25500,31500,NULL,CURRENT_TIMESTAMP);
INSERT INTO "VehicleExpense" ("id","vehicleId","date","description","amount") VALUES ('planilha_04_custo','planilha_04','2026-10-01 12:00:00','Custo (planilha)',1400);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_05','QJI4H39','VERSA SV 1.6 16V FLEXSTART AUT BRANCA FAST BACACHERI','2017/2018','2026-10-03 12:00:00',NULL,37150,NULL,NULL,CURRENT_TIMESTAMP);
INSERT INTO "VehicleExpense" ("id","vehicleId","date","description","amount") VALUES ('planilha_05_custo','planilha_05','2026-10-03 12:00:00','Custo (planilha)',150);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_06','AVY3H54','C3 TENDENCE 1.5 FLEX 8V 5P MEC. VERMELHO FAST BACACHERI','2012/2013','2026-10-05 12:00:00',NULL,26000,NULL,NULL,CURRENT_TIMESTAMP);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_07','AZZ7284','GOL BRANCO SINHO',NULL,'2026-10-06 12:00:00',NULL,26500,29000,NULL,CURRENT_TIMESTAMP);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_08',NULL,'CLIO GILA',NULL,NULL,NULL,3200,3700,'Sem placa e sem data na planilha',CURRENT_TIMESTAMP);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_09','QOI0E32','FORD KA SEDAN 1.5 SE/SE PLUS 16V FLEX IRMÃO','2018/2018','2026-10-06 12:00:00','2026-10-23 12:00:00',30268.42,32300,NULL,CURRENT_TIMESTAMP);
INSERT INTO "VehicleExpense" ("id","vehicleId","date","description","amount") VALUES ('planilha_09_custo','planilha_09','2026-10-06 12:00:00','Custo (planilha)',250);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_10','BCK0J60','TORO FREEDOM 2.4 16V FLEX AUT. FAST BACACHERI','2017/2018','2026-10-07 12:00:00','2026-10-15 12:00:00',60300,67000,NULL,CURRENT_TIMESTAMP);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_11','ASQ6C48','NISSAN/LIVINA 1.6 VERMELHA VAAPT BOQUEIRÃO','2009/2010','2026-10-07 12:00:00','2026-10-16 12:00:00',17000,18500,NULL,CURRENT_TIMESTAMP);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_12',NULL,'FOCUS ANDRE PRATA',NULL,NULL,NULL,9000,9900,'Sem placa e sem data na planilha',CURRENT_TIMESTAMP);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_13','DJG4F22','FORD FIESTA 1.6 PROENÇA ARAUCARIA','2003/2004','2026-10-18 12:00:00','2026-10-22 12:00:00',5500,9000,NULL,CURRENT_TIMESTAMP);
INSERT INTO "VehicleExpense" ("id","vehicleId","date","description","amount") VALUES ('planilha_13_custo','planilha_13','2026-10-18 12:00:00','Custo (planilha)',520);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_14','HFZ1970','SPORTAGE EX 2.0 16V/AUT. PRATA','2009/2010','2026-10-19 12:00:00',NULL,24500,28500,'Data de venda na planilha estava 22/01/1900 (erro de digitação) — corrigir',CURRENT_TIMESTAMP);
INSERT INTO "VehicleExpense" ("id","vehicleId","date","description","amount") VALUES ('planilha_14_custo','planilha_14','2026-10-19 12:00:00','Custo (planilha)',333);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_15','QJC1D78','FIESTA SE 1.6 16V FLEX BRANCO','2016/2017','2026-10-21 12:00:00','2026-10-26 12:00:00',35267,39000,NULL,CURRENT_TIMESTAMP);
INSERT INTO "VehicleExpense" ("id","vehicleId","date","description","amount") VALUES ('planilha_15_custo','planilha_15','2026-10-21 12:00:00','Custo (planilha)',120);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_16','BAN1A74','PALIO 1.0 TROFEO FLEX PRATA','2016/2016','2026-10-26 12:00:00','2026-10-26 12:00:00',17281.28,29900,NULL,CURRENT_TIMESTAMP);
INSERT INTO "VehicleExpense" ("id","vehicleId","date","description","amount") VALUES ('planilha_16_custo','planilha_16','2026-10-26 12:00:00','Custo (planilha)',281.28);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_17','FUL5I35','CITROEN C3 TENDENCE PRETO PARTICULAR','2014/2015','2026-10-27 12:00:00',NULL,27909,NULL,NULL,CURRENT_TIMESTAMP);
INSERT INTO "VehicleExpense" ("id","vehicleId","date","description","amount") VALUES ('planilha_17_custo','planilha_17','2026-10-27 12:00:00','Custo (planilha)',409);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_18','HLB5095','LOGAN EXPRESSION PRATA 1.6','2009/2010','2026-10-28 12:00:00','2026-10-30 12:00:00',10034.36,13900,NULL,CURRENT_TIMESTAMP);
INSERT INTO "VehicleExpense" ("id","vehicleId","date","description","amount") VALUES ('planilha_18_custo','planilha_18','2026-10-28 12:00:00','Custo (planilha)',34.36);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_19','AUP8F90','FOX/1.6 PRIME GII VERMELHO HOLANDA IRMÃO','2011/2012','2026-10-29 12:00:00','2026-11-05 12:00:00',23000,27000,NULL,CURRENT_TIMESTAMP);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_20','RHK7C00','VW/NIVUS HL TSI CINZA','2024/2024','2026-10-31 12:00:00',NULL,83637.87,96000,NULL,CURRENT_TIMESTAMP);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_21','AZV3B73','RENAULT/DUSTER 2.0 4X2 PRETA AUT','2015/2016','2026-11-03 12:00:00','2026-11-03 12:00:00',33000,35000,NULL,CURRENT_TIMESTAMP);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_22','ASK7191','C3 GLX 1.4/GLX SONORA 1.4 PRATA','2011/2011','2026-11-04 12:00:00','2026-11-06 12:00:00',12970.79,NULL,NULL,CURRENT_TIMESTAMP);
INSERT INTO "VehicleExpense" ("id","vehicleId","date","description","amount") VALUES ('planilha_22_custo','planilha_22','2026-11-04 12:00:00','Custo (planilha)',50);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_23','AXR5E92','CITROEN C3 PICASSO GLX VERMELHO 1.6 AUT','2013/2014','2026-11-06 12:00:00',NULL,23920.21,NULL,NULL,CURRENT_TIMESTAMP);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_24','NJJ4887','VW/CROSSFOX 1.6 MI TOTAL FLEX 8V PRETO','2009/2010','2026-11-06 12:00:00',NULL,21000,NULL,NULL,CURRENT_TIMESTAMP);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_25','MRN6H78','PALIO EXL 1.4 FIRE/30 ANOS FLEX 8V 4P PRETO','2007/2008','2026-11-06 12:00:00',NULL,17000,NULL,NULL,CURRENT_TIMESTAMP);
INSERT INTO "Vehicle" ("id","plate","model","year","purchaseDate","saleDate","purchasePrice","salePrice","notes","updatedAt") VALUES ('planilha_26','ANG8377','GM/CORSA CLASSIC LIFE','2005/2006','2026-11-07 12:00:00',NULL,12500,NULL,'PEGAMOS NO PEUGEOT',CURRENT_TIMESTAMP);
