export class Dice {
  sides: number;

  constructor(sides: number) {
    if (sides < 2) throw new Error("Dice must have at least 2 sides.");
    this.sides = sides;
  }

  roll(): number {
    return Math.floor(Math.random() * this.sides) + 1;
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
