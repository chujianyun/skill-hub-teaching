import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
export class LoginDto {
  @IsString() @IsNotEmpty() @MaxLength(64) phone!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) password!: string;
}
