/** Startwaarden uit "Nieuwe vastgestelde regelplekken 2027" (tabblad Parameters); aan te passen onder Instellingen. */

export type ClusterCode = 'N' | 'NW' | 'O' | 'W' | 'ZO' | 'ZW';

export interface NormRegio {
  cluster: ClusterCode;
  /** In het begrotingsjaar. */
  natura: number;
  /** CBS, in het werkgebied. */
  cbs: number;
  /** Begroting. */
  vrijeMarkt: number;
  /** Hoe sterk het landelijke seizoen in deze regio doorwerkt. */
  amplitude: number;
  /** Diensten van 4 uur per dag, maandag t/m zaterdag. */
  voorgangen: number;
  /** Per kwartaal. */
  fte: [number, number, number, number];
  correctie: number;
}

export interface NormParameters {
  bron: string;
  /** Uren. */
  dienstUren: number;
  /** Gewogen duur = kans × dienstUren. Afgesproken 1 op de 4 (2 uur); de Excel rekende met 37,5%. */
  beschikbaarKans: number;
  voorgangUren: number;
  beschikbaarPerDag: number;
  voorgangDagen: number;
  dekkingRegio: number;
  dekkingCluster: number;
  verzuim: number;
  /**
   * Kort verzuim op de dag zelf, voor de kans dat een 1B valt. Standaard 0. Niet het verzuim uit de norm: wie langer
   * ziek is, staat al als Z in het rooster.
   */
  uitval: number;
  verlof: number;
  urenPerFte: number;
  trend: number;
  dagenPerJaar: number;
  /** Maandag t/m zondag. */
  dagIndex: number[];
  /** Week 1 t/m 52. */
  seizoen: number[];
  regios: Record<string, NormRegio>;
}

export const NORM_STANDAARD: NormParameters = {
  bron: 'Nieuwe vastgestelde regelplekken 2027',
  dienstUren: 8,
  beschikbaarKans: 0.25,
  voorgangUren: 4,
  beschikbaarPerDag: 1,
  voorgangDagen: 6,
  dekkingRegio: 0.8,
  dekkingCluster: 0.95,
  verzuim: 0.085,
  uitval: 0,
  verlof: 0.129,
  urenPerFte: 40,
  trend: 1,
  dagenPerJaar: 365,
  dagIndex: [0.986, 1.021, 1.024, 1.043, 1.049, 0.964, 0.913],
  seizoen: [1.1233, 1.1342, 1.1427, 1.1482, 1.15, 1.1476, 1.1409, 1.1299, 1.1152, 1.0972, 1.0769, 1.0554, 1.0337, 1.0128, 0.9937, 0.9769, 0.9629, 0.9518, 0.9435, 0.9374, 0.9331, 0.9298, 0.927, 0.9241, 0.9206, 0.9164, 0.9116, 0.9063, 0.901, 0.8963, 0.8927, 0.8907, 0.8909, 0.8934, 0.8985, 0.9059, 0.9154, 0.9266, 0.9391, 0.9523, 0.9658, 0.9793, 0.9925, 1.0055, 1.0182, 1.0308, 1.0436, 1.0566, 1.0699, 1.0836, 1.0974, 1.1108],
  regios: {
    "Amsterdam": { cluster: 'NW', natura: 1388.6, cbs: 11235, vrijeMarkt: 0.0309078895964011, amplitude: 0.784, voorgangen: 4, fte: [12.825, 12.825, 12.825, 12.825], correctie: 1 },
    "Arnhem": { cluster: 'O', natura: 1575.7, cbs: 5259, vrijeMarkt: 0.0408461974902908, amplitude: 0.862, voorgangen: 4, fte: [14.72, 14.72, 14.72, 14.72], correctie: 1 },
    "Breda": { cluster: 'ZW', natura: 1688.8, cbs: 4017, vrijeMarkt: 0.06871245985596, amplitude: 1.045, voorgangen: 4, fte: [14.39, 14.39, 14.39, 14.19], correctie: 1 },
    "Den Bosch": { cluster: 'ZW', natura: 1663.1, cbs: 5849, vrijeMarkt: 0.047, amplitude: 0.954, voorgangen: 4, fte: [15.105, 15.105, 15.105, 15.105], correctie: 1 },
    "Eindhoven": { cluster: 'ZW', natura: 1516.8, cbs: 3072, vrijeMarkt: 0.1, amplitude: 0.993, voorgangen: 4, fte: [14.6, 14.6, 14.6, 14.6], correctie: 1 },
    "Friesland": { cluster: 'N', natura: 1133.2, cbs: 7083, vrijeMarkt: 0.028336660673027, amplitude: 0.847, voorgangen: 4, fte: [10.4, 10.4, 9.6, 9.6], correctie: 1 },
    "Groningen": { cluster: 'N', natura: 969.9, cbs: 7131, vrijeMarkt: 0.075, amplitude: 0.873, voorgangen: 4, fte: [13.41, 13.41, 12.65, 12.65], correctie: 1 },
    "Haaglanden": { cluster: 'W', natura: 1064.5, cbs: 11248, vrijeMarkt: 0.0306619572339367, amplitude: 0.824, voorgangen: 4, fte: [10.4, 10.4, 10.4, 10.4], correctie: 1 },
    "Rotterdam": { cluster: 'W', natura: 1161.9, cbs: 8418, vrijeMarkt: 0.059349266549549, amplitude: 1.069, voorgangen: 4, fte: [12.34, 12.34, 12.34, 12.34], correctie: 1 },
    "Kempenland": { cluster: 'ZO', natura: 1656.7, cbs: 3812, vrijeMarkt: 0.0550959743375924, amplitude: 1.052, voorgangen: 4, fte: [13.8, 13.8, 13.25, 13.25], correctie: 1 },
    "Midden Limburg": { cluster: 'ZO', natura: 1411.1, cbs: 5332, vrijeMarkt: 0.0606679869779775, amplitude: 1.082, voorgangen: 4, fte: [15.275, 15.275, 14.625, 14.625], correctie: 1 },
    "Midden Nederland": { cluster: 'O', natura: 1174.2, cbs: 9204, vrijeMarkt: 0.0346849920121482, amplitude: 0.978, voorgangen: 4, fte: [11.9, 11.9, 11.9, 11.9], correctie: 1 },
    "Nijmegen": { cluster: 'O', natura: 1819.4, cbs: 4097, vrijeMarkt: 0.056, amplitude: 0.924, voorgangen: 4, fte: [15.34, 15.34, 15.34, 15.34], correctie: 1 },
    "Noord-Holland": { cluster: 'NW', natura: 857.4, cbs: 6548, vrijeMarkt: 0.0304282495347879, amplitude: 1.099, voorgangen: 4, fte: [9.5, 9.5, 9.5, 9.5], correctie: 1 },
    "Noord-Holland Midden": { cluster: 'NW', natura: 684.1, cbs: 4940, vrijeMarkt: 0.0953102593322642, amplitude: 0.929, voorgangen: 4, fte: [8.74, 8.74, 8.74, 8.74], correctie: 1 },
    "Noord-Oost": { cluster: 'N', natura: 796.9, cbs: 9430, vrijeMarkt: 0.0544480715720933, amplitude: 1.027, voorgangen: 4, fte: [11.85, 11.85, 11.85, 11.85], correctie: 1 },
    "Oost Brabant": { cluster: 'ZO', natura: 1506, cbs: 5861, vrijeMarkt: 0.0239478322046067, amplitude: 0.999, voorgangen: 4, fte: [14.71, 14.598, 14.598, 14.598], correctie: 1 },
    "Spaarne-Rijnland": { cluster: 'NW', natura: 1060.9, cbs: 10027, vrijeMarkt: 0.0418454395515443, amplitude: 1.153, voorgangen: 4, fte: [10.8, 10.8, 10.8, 10.8], correctie: 1 },
    "Tilburg": { cluster: 'ZW', natura: 1797.6, cbs: 3931, vrijeMarkt: 0.0560888936860684, amplitude: 0.99, voorgangen: 4, fte: [14.3, 14.3, 14.3, 13.3], correctie: 1 },
    "Twente/Achterhoek": { cluster: 'N', natura: 1416.7, cbs: 9636, vrijeMarkt: 0.033, amplitude: 1.021, voorgangen: 4, fte: [15.275, 15.275, 15.275, 15.275], correctie: 1 },
    "Utrecht": { cluster: 'O', natura: 1003.9, cbs: 6764, vrijeMarkt: 0.065, amplitude: 0.962, voorgangen: 4, fte: [11.61, 11.61, 11.61, 11.61], correctie: 1 },
    "Veluwe-IJssel": { cluster: 'N', natura: 840.4, cbs: 7657, vrijeMarkt: 0.0426079273867753, amplitude: 1.095, voorgangen: 4, fte: [10.04, 10.04, 10.04, 10.04], correctie: 1 },
    "West Brabant/Zeeland": { cluster: 'W', natura: 1657.8, cbs: 7831, vrijeMarkt: 0.0313536496184329, amplitude: 0.993, voorgangen: 4, fte: [16.44, 15.8, 15.8, 15.8], correctie: 1 },
    "Zuid Holland Zuid": { cluster: 'W', natura: 1157, cbs: 7993, vrijeMarkt: 0.0353504419379525, amplitude: 1.225, voorgangen: 4, fte: [11.04, 11.04, 11.04, 11.04], correctie: 1 },
    "Zuid Limburg": { cluster: 'ZO', natura: 1738.2, cbs: 5939, vrijeMarkt: 0.0549392183769935, amplitude: 1.238, voorgangen: 4, fte: [16.2, 16.2, 15.5, 15.5], correctie: 1 },
  },
};
