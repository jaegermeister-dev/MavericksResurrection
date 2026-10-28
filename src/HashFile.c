/* Streaming SHA-256 with measured byte progress; compatible with OS X 10.10. */
#include <CommonCrypto/CommonDigest.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
#include <string.h>
int main(int argc,char **argv){
    if(argc!=2)return 2;
    int fd=open(argv[1],O_RDONLY|O_NOFOLLOW);struct stat a,b;
    if(fd<0||fstat(fd,&a)||!S_ISREG(a.st_mode)){perror("Cannot open hash input");return 1;}
    const size_t chunk=4*1024*1024;unsigned char *buffer=malloc(chunk),digest[CC_SHA256_DIGEST_LENGTH];
    if(!buffer){close(fd);return 1;}
    CC_SHA256_CTX state;CC_SHA256_Init(&state);off_t done=0;int last=-1;
    for(;;){ssize_t n=read(fd,buffer,chunk);if(n<0&&errno==EINTR)continue;if(n<0){perror("Hash read");return 1;}if(!n)break;
        CC_SHA256_Update(&state,buffer,(CC_LONG)n);done+=n;
        int percent=a.st_size?(int)(100.0*(double)done/(double)a.st_size):100;
        if(percent!=last){printf("{\"percent\":%d,\"bytes\":%lld}\n",percent,(long long)done);fflush(stdout);last=percent;}
    }
    if(fstat(fd,&b)||a.st_dev!=b.st_dev||a.st_ino!=b.st_ino||a.st_size!=b.st_size||done!=a.st_size||
       a.st_mtimespec.tv_sec!=b.st_mtimespec.tv_sec||a.st_mtimespec.tv_nsec!=b.st_mtimespec.tv_nsec||
       a.st_ctimespec.tv_sec!=b.st_ctimespec.tv_sec||a.st_ctimespec.tv_nsec!=b.st_ctimespec.tv_nsec){fprintf(stderr,"Hash input changed\n");return 1;}
    CC_SHA256_Final(digest,&state);printf("{\"sha256\":\"");for(size_t i=0;i<sizeof(digest);i++)printf("%02x",digest[i]);printf("\",\"bytes\":%lld}\n",(long long)done);
    free(buffer);close(fd);return 0;
}
