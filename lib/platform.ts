export type Platform = 'lokaal' | 'azure';

/** NEXT_PUBLIC_GRIP_PLATFORM wordt bij het bouwen vastgezet, dus server en browser zijn het altijd eens. */
export function platform(): Platform {
  return process.env.NEXT_PUBLIC_GRIP_PLATFORM === 'azure' ? 'azure' : 'lokaal';
}

/** Een gedeelde database met inloggen. Lokaal staat alles in deze browser. */
export const gedeeld = () => platform() !== 'lokaal';

/**
 * Of GRIP zelf gasten uitnodigt in Entra ID bij het toevoegen van een gebruiker. Uit met NEXT_PUBLIC_GRIP_GASTEN=uit
 * (bij het bouwen): dan regelt de organisatie de toegang, bijvoorbeeld met een security group.
 */
export const gastenUitnodigen = () => platform() === 'azure' && process.env.NEXT_PUBLIC_GRIP_GASTEN !== 'uit';
