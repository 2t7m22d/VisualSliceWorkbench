! Native Fortran replacement for plot_auto.f90 output; no Python/runtime libraries.
program plot_auto_bfslice
  use iso_fortran_env, only: real64, int64, int8, error_unit
  implicit none
  integer :: nx,ny,nz,nf,ns,ns1,disl_n,kstep,kprnt0,kprnt,kstart

  ! 可设置选项，-1代表程序自动读入或默认值
  integer :: xcutplan=100,ycutplan=100,zcutplan=-1,zcutplan1=30,zcutplan2=120
  integer :: tSTART=-1,tEND=-1,tSTEP=-1,XYopen=0,XZopen=0,YZopen=0,XYZopen=1,COMBINEopen=0
  ! 选择X,Y坐标的范围，part_count设置为对应的文件分片数
  integer :: xfirst=1,xlast=-1,yfirst=1,ylast=-1,part_count=20  
  character(512) :: input_dir='.',output_dir='.',line,filename,config
  character(3) :: field_name='P'

  real(real64),allocatable :: p(:,:,:,:)
  logical,allocatable :: seen(:,:,:)
  real(real64) :: px,py,pz
  integer :: u,ios,i,j,k,part,ts,hd(3),row,astat
  integer(int64) :: total,received
  logical :: exists
  character(8) :: stamp
  namelist /slice/ xcutplan,ycutplan,zcutplan,zcutplan1,zcutplan2,tSTART,tEND,tSTEP, &
    XYopen,XZopen,YZopen,XYZopen,COMBINEopen,xfirst,xlast,yfirst,ylast,part_count, &
    input_dir,output_dir,field_name

  ! Check the binary representation without requiring the IEEE_ARITHMETIC module.
  if(storage_size(0.0_real64)/=64.or.storage_size(0_int8)/=8.or.bit_size(0_int64)/=64) &
    call die('64-bit real/integer storage and 8-bit bytes are required')
  if(radix(0.0_real64)/=2.or.digits(0.0_real64)/=53.or. &
     minexponent(0.0_real64)/=-1021.or.maxexponent(0.0_real64)/=1024) &
    call die('IEEE binary64 numeric model is required')
  if(transfer(1.0_real64,0_int64)/=4607182418800017408_int64.or. &
     transfer(-1.0_real64,0_int64)/=-4616189618054758400_int64.or. &
     transfer(huge(0.0_real64),0_int64)/=9218868437227405311_int64.or. &
     transfer(tiny(0.0_real64),0_int64)/=4503599627370496_int64) &
    call die('Unsupported binary64 representation')
  ! Only the first eight inputN.in records are used by the original slicing logic.
  open(newunit=u,file='inputN.in',status='old',action='read',iostat=ios)
  if(ios/=0) call die('Cannot read inputN.in in current directory')
  do row=1,8
    read(u,'(A)',iostat=ios) line
    if(ios/=0) call die('inputN.in: missing record among first 8 lines')
    select case(row)
    case(3)
      read(line,*,iostat=ios) nx,ny,nz
    case(7)
      read(line,*,iostat=ios) nf,ns,ns1,disl_n
    case(8)
      read(line,*,iostat=ios) kstep,kprnt0,kprnt,kstart
    end select
    if(ios/=0) call die('Invalid dimensions/time fields in inputN.in')
  end do
  close(u)
  config='plot_auto.nml'
  if(command_argument_count()>1) call die('Usage: plot_auto_bfslice [config.nml]')
  if(command_argument_count()==1) call get_command_argument(1,config)
  inquire(file=trim(config),exist=exists)
  if(command_argument_count()==1.and..not.exists) call die('Requested config file does not exist')
  if(exists) then
    open(newunit=u,file=trim(config),status='old',action='read',iostat=ios)
    if(ios/=0) call die('Cannot open config')
    read(u,nml=slice,iostat=ios)
    if(ios/=0) call die('Invalid &slice namelist')
    close(u)
  end if
  if(zcutplan==-1) zcutplan=nf+ns-5
  if(tSTART==-1) tSTART=kstart
  if(tEND==-1) tEND=kstep
  if(tSTEP==-1) tSTEP=kprnt0
  if(xlast==-1) xlast=nx
  if(ylast==-1) ylast=ny
  if(min(nx,ny,nz)<=0.or.part_count<=0) call die('Dimensions and part_count must be positive')
  if(tSTEP<=0.or.tSTART<0.or.tEND<tSTART) call die('Invalid time interval')
  if(int(tEND,int64)+int(part_count,int64)-1>99999999_int64) call die('8-digit file index overflow')
  if(min(XYopen,XZopen,YZopen,XYZopen,COMBINEopen)<0.or. &
     max(XYopen,XZopen,YZopen,XYZopen,COMBINEopen)>1) call die('Output switches must be 0 or 1')
  if(XYopen+XZopen+YZopen+XYZopen+COMBINEopen==0) call die('No output selected')
  if(trim(field_name)/='P'.and.trim(field_name)/='AFD') call die('field_name must be P or AFD')
  call bounds(xfirst,xlast,nx,'x crop');call bounds(yfirst,ylast,ny,'y crop')
  if(XYopen==1) call bounds(zcutplan,zcutplan,nz,'XY z layer')
  if(XZopen==1) call bounds(ycutplan,ycutplan,ny,'XZ y layer')
  if(YZopen==1) call bounds(xcutplan,xcutplan,nx,'YZ x layer')
  if(XYZopen==1) call bounds(zcutplan1,zcutplan2,nz,'3D z crop')
  total=int(nx,int64)*int(ny,int64)*int(nz,int64)
  allocate(p(3,nx,ny,nz),seen(nx,ny,nz),stat=astat)
  if(astat/=0) call die('Insufficient memory for complete input volume')
  do ts=tSTART,tEND,tSTEP
    seen=.false.;received=0
    do part=0,part_count-1
      write(stamp,'(I8.8)') ts+part
      filename=trim(input_dir)//'/PELOOP.'//stamp//'.dat'
      open(newunit=u,file=trim(filename),status='old',action='read',iostat=ios)
      if(ios/=0) call die('Cannot read '//trim(filename))
      if(part==0) then
        read(u,*,iostat=ios) hd
        if(ios/=0) call die('Missing first-part dimensions')
        if(any(hd/=[nx,ny,nz])) call die('First-part dimensions differ from inputN.in')
      end if
      do
        read(u,'(A)',iostat=ios) line
        if(ios<0) exit
        if(ios/=0) call die('Read failure: '//trim(filename))
        if(len_trim(line)==0) cycle
        read(line,*,iostat=ios) i,j,k,px,py,pz
        if(ios/=0) call die('Invalid six-column record: '//trim(filename))
        if(i<1.or.i>nx.or.j<1.or.j>ny.or.k<1.or.k>nz) call die('Coordinate outside declared grid')
        if(seen(i,j,k)) call die('Duplicate grid point in input parts')
        if(.not.all(finite_binary64([px,py,pz]))) call die('NaN/Inf in input')
        seen(i,j,k)=.true.;p(:,i,j,k)=[px,py,pz];received=received+1
      end do
      close(u)
    end do
    if(received/=total.or..not.all(seen)) call die('Input parts do not cover the complete grid')
    ! Preserve legacy naming: suffix is the LAST part index, not the first index.
    write(stamp,'(I8.8)') ts+part_count-1
    if(XYopen==1) call absent('XY.'//stamp//'.bfslice')
    if(XZopen==1) call absent('XZ.'//stamp//'.bfslice')
    if(YZopen==1) call absent('YZ.'//stamp//'.bfslice')
    if(XYZopen==1) call absent('3D.'//stamp//'.bfslice')
    if(COMBINEopen==1) call absent('PELOOP.'//stamp//'-all.bfslice')
    if(XYopen==1) call emit('XY.'//stamp//'.bfslice',xfirst,xlast,yfirst,ylast,zcutplan,zcutplan)
    if(XZopen==1) call emit('XZ.'//stamp//'.bfslice',xfirst,xlast,ycutplan,ycutplan,1,nz)
    if(YZopen==1) call emit('YZ.'//stamp//'.bfslice',xcutplan,xcutplan,yfirst,ylast,1,nz)
    if(XYZopen==1) call emit('3D.'//stamp//'.bfslice',xfirst,xlast,yfirst,ylast,zcutplan1,zcutplan2)
    if(COMBINEopen==1) call emit('PELOOP.'//stamp//'-all.bfslice',1,nx,1,ny,1,nz)
  end do
contains
  elemental logical function finite_binary64(value)
    real(real64),intent(in)::value
    ! All-ones exponent denotes either infinity or NaN, regardless of sign/payload.
    ! Bit inspection avoids floating-point comparisons and needs no intrinsic module.
    finite_binary64=ibits(transfer(value,0_int64),52,11)/=2047_int64
  end function
  subroutine die(message)
    character(*),intent(in) :: message
    write(error_unit,'(A)') 'ERROR: '//message
    stop 1
  end subroutine
  subroutine bounds(lo,hi,n,label)
    integer,intent(in)::lo,hi,n
    character(*),intent(in)::label
    if(lo<1.or.hi<lo.or.hi>n) call die('Invalid '//label)
  end subroutine
  function num(v) result(s)
    integer(int64),intent(in)::v
    character(:),allocatable::s
    character(32)::tmp
    write(tmp,'(I0)')v
    s=trim(tmp)
  end function
  function ni(v) result(s)
    integer,intent(in)::v
    character(:),allocatable::s
    s=num(int(v,int64))
  end function
  subroutine absent(name)
    character(*),intent(in)::name
    logical::found
    inquire(file=trim(output_dir)//'/'//name,exist=found)
    if(found) call die('Refusing to overwrite '//name)
  end subroutine
  subroutine pack(bits,n,bytes)
    integer(int64),intent(in)::bits
    integer,intent(in)::n
    integer(int8),intent(out)::bytes(n)
    integer::b,t
    do b=0,n-1
      t=int(ibits(bits,b*8,8));if(t>127)t=t-256
      bytes(b+1)=int(t,int8)
    end do
  end subroutine
  subroutine emit(name,x0,x1,y0,y1,z0,z1)
    character(*),intent(in)::name
    integer,intent(in)::x0,x1,y0,y1,z0,z1
    character(:),allocatable::header
    integer::v,err,ix,iy,iz,c,pos,sx,sy,sz
    integer(int64)::bytes,bits
    integer(int8)::length_bytes(4)
    integer(int8),allocatable::buffer(:)
    sx=x1-x0+1;sy=y1-y0+1;sz=z1-z0+1
    bytes=24_int64*sx*sy*sz
    header='{"schema":"bfo-vector-slice-v1","title":"'//name// &
      '","shape_zyxc":['//ni(sz)//','//ni(sy)//','//ni(sx)//',3],'// &
      '"origin_nm":[0,0,0],"spacing_nm":[1,1,1],'// &
      '"index_ranges_xyz":[['//ni(x0-1)//','//ni(x1)//'],['//ni(y0-1)//','//ni(y1)// &
      '],['//ni(z0-1)//','//ni(z1)//']],"coordinate_unit":"grid_index",'// &
      '"coordinates":"original 1-based grid; nm fields are placeholders, not calibrated lengths",'// &
      '"source_first_part":'//ni(ts)//',"source_last_part":'//ni(ts+part_count-1)// &
      ',"fields":[{"name":"'//trim(field_name)//'","dtype":"float64","offset":0,"bytes":'// &
      num(bytes)//'}]}'
    call pack(int(len(header),int64),4,length_bytes)
    open(newunit=v,file=trim(output_dir)//'/'//name,status='new',access='stream', &
      form='unformatted',action='write',iostat=err)
    if(err/=0) call die('Cannot create '//name//' (output directory must exist)')
    write(v,iostat=err) 'BFOSLC1'//achar(10),length_bytes,header
    if(err/=0) call die('Header write failure: '//name)
    allocate(buffer(24*sx))
    ! Payload ordering is z,y,x,component; component is the fastest varying index.
    do iz=z0,z1
      do iy=y0,y1
        pos=1
        do ix=x0,x1
          do c=1,3
            bits=transfer(p(c,ix,iy,iz),0_int64)
            call pack(bits,8,buffer(pos:pos+7));pos=pos+8
          end do
        end do
        write(v,iostat=err) buffer
        if(err/=0) call die('Payload write failure: '//name)
      end do
    end do
    close(v,iostat=err)
    if(err/=0) call die('Close failure: '//name)
    write(*,'(A)') 'Wrote '//name//' ['//ni(sx)//','//ni(sy)//','//ni(sz)//']'
  end subroutine
end program
