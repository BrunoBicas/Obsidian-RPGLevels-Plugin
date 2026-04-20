export class Dice {
  sides: number;

  constructor(sides: number) {
    if (sides < 2) throw new Error("Dice must have at least 2 sides.");
    this.sides = sides;
  }

  roll(): number {
    return Math.floor(Math.random() * this.sides) + 1;
  }

  rollWithAdvantage(): { firstRoll: number; secondRoll: number; selectedRoll: number; isCritical: boolean; isCriticalFail: boolean } {
    const firstRoll = this.roll();
    const secondRoll = this.roll();
    const selectedRoll = Math.max(firstRoll, secondRoll);

    return {
      firstRoll,
      secondRoll,
      selectedRoll,
      isCritical: this.isCritical(selectedRoll),
      isCriticalFail: this.isCriticalFail(selectedRoll),
    };
  }

  rollCheck(modifier: number = 0, useAdvantage: boolean = false): {
    total: number;
    selectedRoll: number;
    firstRoll: number;
    secondRoll?: number;
    usedAdvantage: boolean;
    isCritical: boolean;
    isCriticalFail: boolean;
  } {
    if (useAdvantage) {
      const advantageRoll = this.rollWithAdvantage();
      return {
        total: advantageRoll.selectedRoll + modifier,
        selectedRoll: advantageRoll.selectedRoll,
        firstRoll: advantageRoll.firstRoll,
        secondRoll: advantageRoll.secondRoll,
        usedAdvantage: true,
        isCritical: advantageRoll.isCritical,
        isCriticalFail: advantageRoll.isCriticalFail,
      };
    }

    const firstRoll = this.roll();
    return {
      total: firstRoll + modifier,
      selectedRoll: firstRoll,
      firstRoll,
      usedAdvantage: false,
      isCritical: this.isCritical(firstRoll),
      isCriticalFail: this.isCriticalFail(firstRoll),
    };
  }

  isCritical(rollValue: number): boolean {
    return this.sides === 20 && rollValue === 20;
  }

  isCriticalFail(rollValue: number): boolean {
    return this.sides === 20 && rollValue === 1;
  }

  average(): number {
    return Math.floor((this.sides + 1) / 2);
  }

  toString(): string {
    return `d${this.sides}`;
  }

  static fromString(type: string): Dice {
    if (!/^d\d+$/.test(type)) throw new Error(`Invalid dice type: ${type}`);
    return new Dice(parseInt(type.slice(1)));
  }
}
